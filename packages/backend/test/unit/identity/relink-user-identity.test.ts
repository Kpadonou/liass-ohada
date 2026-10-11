import {
  DynamoDBClient,
  DescribeTableCommand,
  ScanCommand,
  TransactWriteItemsCommand,
  TransactionCanceledException,
  GetItemCommand,
  QueryCommand,
  BatchGetItemCommand,
} from "@aws-sdk/client-dynamodb";
import {
  CognitoIdentityProviderClient,
  DescribeUserPoolCommand,
  ListUsersCommand,
  AdminGetUserCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { mockClient } from "aws-sdk-client-mock";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import {
  planRelink,
  relinkUserIdentity,
  RelinkOptions,
} from "../../../scripts/identity/relink";
import { parseRelinkArgs } from "../../../scripts/relink-user-identity";
import { KeyFactory as K } from "../../../lambda/shared/key-builder";
import { handler } from "../../../lambda/domains/identity/get-workspaces";
import { config } from "../../../lambda/shared/dynamo-client";

const oldId = "11111111-1111-1111-1111-111111111111",
  newId = "22222222-2222-2222-2222-222222222222";
const options: RelinkOptions = {
  oldUserId: oldId,
  newUserId: newId,
  email: "Owner@example.com",
  stage: "dev",
  tableName: "liass-ohada-dev-accounting-table",
  userPoolId: "eu-west-3_test",
  region: "eu-west-3",
  apply: false,
  maintenanceConfirmed: false,
};
const ddb = mockClient(DynamoDBClient),
  cognito = mockClient(CognitoIdentityProviderClient);
const clients = {
  dynamo: new DynamoDBClient({ region: options.region }),
  cognito: new CognitoIdentityProviderClient({ region: options.region }),
};
type Row = Record<string, unknown>;
let rows: Row[];
const sameKey = (a: Row, b: Row) => a.PK === b.PK && a.SK === b.SK;
const now = "2026-01-01T00:00:00.000Z";
const initial = (): Row[] => [
  {
    PK: K.userProfilePK(oldId),
    SK: K.userProfileSK(),
    entityType: "USER_PROFILE",
    userId: oldId,
    email: "owner@example.com",
    normalizedEmail: "owner@example.com",
    emailVerified: true,
    displayName: "Owner",
    createdAt: now,
    updatedAt: now,
    lastSyncedFromIdentityAt: now,
    customMetadata: { preserve: true },
  },
  {
    PK: K.userEmailLookupPK("owner@example.com"),
    SK: K.userEmailLookupSK(),
    entityType: "USER_EMAIL_LOOKUP",
    userId: oldId,
    normalizedEmail: "owner@example.com",
    createdAt: now,
    updatedAt: now,
  },
  {
    PK: K.orgKey("org-1"),
    SK: K.orgUserAccessSK(oldId),
    entityType: "USER_ORG_ACCESS",
    userId: oldId,
    orgId: "org-1",
    status: "ACTIVE",
    role: "OWNER",
    workspaceType: "COMPANY",
    displayName: "Existing workspace",
    country: "BJ",
    accountingFramework: "SYSCOHADA",
    productRoles: { RESTAURANTS: "OWNER" },
    createdAt: now,
    updatedAt: now,
    GSI6PK: K.userWorkspacesPK(oldId),
    GSI6SK: K.userWorkspaceSK("ACTIVE", "org-1"),
  },
  {
    PK: K.userWorkspacesPK(oldId),
    SK: K.initialWorkspaceLockSK(),
    entityType: "INITIAL_WORKSPACE_LOCK",
    userId: oldId,
    orgId: "org-1",
    status: "ACTIVE",
    createdAt: now,
  },
  {
    PK: K.orgKey("org-1"),
    SK: K.organizationSK(),
    entityType: "ORGANIZATION",
    orgId: "org-1",
    ownerUserId: oldId,
    name: "Existing workspace",
    workspaceType: "COMPANY",
    country: "BJ",
    status: "ACTIVE",
    createdAt: now,
    updatedAt: now,
  },
];
const attributes = (
  email = "OWNER@example.com",
  verified = "true",
  sub = newId,
) => [
  { Name: "sub", Value: sub },
  { Name: "email", Value: email },
  { Name: "email_verified", Value: verified },
];

// Minimal atomic DynamoDB emulator: validate the entire read set before applying
// any operation. Real transaction cancellation semantics are owned by DynamoDB.
function installTransactionEmulator() {
  ddb.on(TransactWriteItemsCommand).callsFake((input) => {
    for (const action of input.TransactItems ?? []) {
      const write = action.Put ?? action.Delete ?? action.Update!;
      const target = unmarshall(
        action.Put ? action.Put.Item! : (action.Delete ?? action.Update!).Key!,
      );
      const current = rows.find((r) => sameKey(r, target));
      let valid = true;
      if (write.ConditionExpression?.startsWith("attribute_not_exists"))
        valid = !current;
      else
        for (const [alias, name] of Object.entries(
          write.ExpressionAttributeNames ?? {},
        )) {
          if (!alias.startsWith("#a")) continue;
          const value =
            write.ExpressionAttributeValues?.[`:v${alias.slice(2)}`];
          valid &&=
            !!current &&
            JSON.stringify(current[String(name)]) ===
              JSON.stringify(unmarshall({ value: value! }).value);
        }
      if (!valid)
        throw new TransactionCanceledException({
          $metadata: {},
          message: "conditional failure",
        });
    }
    const next = structuredClone(rows);
    for (const action of input.TransactItems ?? []) {
      if (action.Put) next.push(unmarshall(action.Put.Item!));
      if (action.Delete) {
        const target = unmarshall(action.Delete.Key!);
        next.splice(
          next.findIndex((r) => sameKey(r, target)),
          1,
        );
      }
      if (action.Update) {
        const target = next.find((r) =>
          sameKey(r, unmarshall(action.Update!.Key!)),
        )!;
        for (const [alias, name] of Object.entries(
          action.Update.ExpressionAttributeNames ?? {},
        ))
          if (alias.startsWith("#c"))
            target[String(name)] = unmarshall({
              value:
                action.Update.ExpressionAttributeValues![`:c${alias.slice(2)}`],
            }).value;
      }
    }
    rows = next;
    return {};
  });
}
const run = (overrides: Partial<RelinkOptions> = {}) =>
  relinkUserIdentity({ ...options, ...overrides }, clients, jest.fn());
const apply = () => run({ apply: true, maintenanceConfirmed: true });
const event = (sub: string) => ({
  version: "2.0",
  routeKey: "GET /me/workspaces",
  rawPath: "/me/workspaces",
  rawQueryString: "",
  headers: { "accept-language": "en" },
  requestContext: {
    http: {
      method: "GET",
      path: "/me/workspaces",
      protocol: "HTTP/1.1",
      sourceIp: "127.0.0.1",
      userAgent: "jest",
    },
    authorizer: {
      jwt: {
        claims: { sub, email: "owner@example.com", email_verified: "true" },
        scopes: [],
      },
    },
  },
  isBase64Encoded: false,
});

beforeEach(() => {
  ddb.reset();
  cognito.reset();
  rows = initial();
  ddb.on(DescribeTableCommand).resolves({
    Table: {
      TableArn: `arn:aws:dynamodb:eu-west-3:123:table/${options.tableName}`,
    },
  });
  cognito.on(DescribeUserPoolCommand).resolves({
    UserPool: {
      Name: "liass-ohada-dev-users",
      Arn: "arn:aws:cognito-idp:eu-west-3:123:userpool/eu-west-3_test",
    },
  });
  cognito
    .on(ListUsersCommand)
    .resolves({ Users: [{ Username: "Google_provider-user" }] });
  cognito
    .on(AdminGetUserCommand)
    .resolves({ Enabled: true, UserAttributes: attributes() });
  ddb
    .on(ScanCommand)
    .callsFake(() => ({ Items: rows.map((r) => marshall(r)) }));
  ddb.on(GetItemCommand).callsFake((input) => ({
    Item: rows.find((r) => sameKey(r, unmarshall(input.Key!)))
      ? marshall(rows.find((r) => sameKey(r, unmarshall(input.Key!)))!)
      : undefined,
  }));
  ddb.on(QueryCommand).callsFake((input) => ({
    Items: rows
      .filter(
        (r) =>
          r.GSI6PK === input.ExpressionAttributeValues?.[":pk"].S &&
          String(r.GSI6SK).startsWith(
            input.ExpressionAttributeValues?.[":skPrefix"].S ?? "",
          ),
      )
      .map((r) => marshall(r)),
  }));
  ddb.on(BatchGetItemCommand).callsFake(() => ({
    Responses: {
      [config.TABLE_NAME]: rows
        .filter((r) => r.entityType === "ORGANIZATION")
        .map((r) => marshall(r)),
    },
  }));
  installTransactionEmulator();
});

test("dry run verifies Cognito by sub/authoritative username and performs zero writes", async () => {
  const original = structuredClone(rows);
  const result = await run();
  expect(result).toMatchObject({
    creates: 3,
    deletes: 3,
    updates: 2,
    transactionActions: 8,
    validations: "PASSED",
    safeToApply: false,
  });
  expect(cognito.commandCalls(ListUsersCommand)[0].args[0].input.Filter).toBe(
    `sub = "${newId}"`,
  );
  expect(
    cognito.commandCalls(AdminGetUserCommand)[0].args[0].input.Username,
  ).toBe("Google_provider-user");
  expect(ddb.commandCalls(TransactWriteItemsCommand)).toHaveLength(0);
  expect(rows).toEqual(original);
});
test.each([
  [
    "unverified",
    attributes("owner@example.com", "false"),
    "NEW_COGNITO_EMAIL_NOT_VERIFIED",
  ],
  [
    "different email",
    attributes("other@example.com"),
    "NEW_COGNITO_EMAIL_MISMATCH",
  ],
  [
    "different sub",
    attributes("owner@example.com", "true", oldId),
    "NEW_COGNITO_IDENTITY_INVALID",
  ],
])("rejects Cognito %s without writes", async (_, attrs, code) => {
  cognito
    .on(AdminGetUserCommand)
    .resolves({ Enabled: true, UserAttributes: attrs });
  await expect(apply()).rejects.toThrow(code);
  expect(ddb.commandCalls(TransactWriteItemsCommand)).toHaveLength(0);
});
test("rejects missing Cognito identity", async () => {
  cognito.on(ListUsersCommand).resolves({ Users: [] });
  await expect(run()).rejects.toThrow("MISSING");
});
test.each([
  [
    "old profile email mismatch",
    () => {
      rows[0].email = "other@example.com";
    },
    "OLD_PROFILE_EMAIL_MISMATCH",
  ],
  [
    "new profile occupied",
    () => {
      rows.push({
        ...rows[0],
        PK: K.userProfilePK(newId),
        userId: newId,
        email: "different@example.com",
      });
    },
    "NEW_APPLICATION_IDENTITY_OCCUPIED",
  ],
  [
    "new memberships occupied",
    () => {
      rows.push({
        ...rows[2],
        SK: K.orgUserAccessSK(newId),
        userId: newId,
        GSI6PK: K.userWorkspacesPK(newId),
      });
    },
    "NEW_APPLICATION_IDENTITY_OCCUPIED",
  ],
  [
    "old profile missing",
    () => {
      rows.shift();
    },
    "OLD_PROFILE_NOT_FOUND_OR_ALREADY_RELINKED",
  ],
  [
    "email ownership changed",
    () => {
      rows[1].userId = "third-user";
    },
    "EMAIL_OWNERSHIP_CHANGED",
  ],
  [
    "unsupported identity record",
    () => {
      rows.push({
        PK: K.userProfilePK(oldId),
        SK: "UNKNOWN",
        entityType: "UNKNOWN",
      });
    },
    "UNSUPPORTED_OLD_IDENTITY_REFERENCE",
  ],
])("rejects %s", async (_, modify, code) => {
  modify();
  await expect(apply()).rejects.toThrow(code);
  expect(ddb.commandCalls(TransactWriteItemsCommand)).toHaveLength(0);
});

test("explicit apply migrates only identity material and rejects a second execution clearly", async () => {
  const original = structuredClone(rows);
  const audit = jest.fn();
  await relinkUserIdentity(
    { ...options, apply: true, maintenanceConfirmed: true },
    clients,
    audit,
  );
  expect(ddb.commandCalls(TransactWriteItemsCommand)).toHaveLength(1);
  expect(rows.find((r) => r.entityType === "USER_PROFILE")).toEqual({
    ...original[0],
    PK: K.userProfilePK(newId),
    userId: newId,
  });
  expect(rows.find((r) => r.entityType === "USER_ORG_ACCESS")).toEqual({
    ...original[2],
    SK: K.orgUserAccessSK(newId),
    userId: newId,
    GSI6PK: K.userWorkspacesPK(newId),
  });
  expect(
    rows.some(
      (r) =>
        r.userId === oldId ||
        r.PK === K.userProfilePK(oldId) ||
        r.GSI6PK === K.userWorkspacesPK(oldId),
    ),
  ).toBe(false);
  expect(rows.filter((r) => r.entityType === "ORGANIZATION")).toHaveLength(1);
  expect(audit).toHaveBeenLastCalledWith(
    expect.objectContaining({
      operation: "USER_IDENTITY_RELINK",
      outcome: "APPLIED",
      oldUserId: oldId,
      newUserId: newId,
      emailSha256: expect.any(String),
      timestamp: expect.any(String),
      stage: "dev",
    }),
  );
  await expect(apply()).rejects.toThrow(
    "OLD_PROFILE_NOT_FOUND_OR_ALREADY_RELINKED",
  );
});

test("normal login never relinks: 409 before explicit migration, same workspaces and 200 afterwards", async () => {
  const oldResponse = await handler(
    event(oldId) as Parameters<typeof handler>[0],
  );
  const original = structuredClone(rows);
  const conflict = await handler(event(newId) as Parameters<typeof handler>[0]);
  expect(conflict.statusCode).toBe(409);
  expect(JSON.parse(conflict.body).error.code).toBe(
    "USER_PROFILE_EMAIL_CONFLICT",
  );
  expect(rows).toEqual(original);
  await apply();
  const newResponse = await handler(
    event(newId) as Parameters<typeof handler>[0],
  );
  expect(newResponse.statusCode).toBe(200);
  expect(JSON.parse(newResponse.body)).toEqual(JSON.parse(oldResponse.body));
  expect(rows.some((r) => r.userId === oldId)).toBe(false);
});

test("transaction cancellation leaves all original records intact", async () => {
  const original = structuredClone(rows);
  ddb
    .on(TransactWriteItemsCommand)
    .rejects(
      new TransactionCanceledException({ $metadata: {}, message: "failure" }),
    );
  await expect(apply()).rejects.toThrow("failure");
  expect(rows).toEqual(original);
});
test("concurrent metadata change is detected without partial migration", async () => {
  cognito.on(AdminGetUserCommand).callsFake(() => {
    if (cognito.commandCalls(AdminGetUserCommand).length === 2)
      rows[2].role = "ACCOUNTANT";
    return { Enabled: true, UserAttributes: attributes() };
  });
  await expect(apply()).rejects.toThrow("conditional failure");
  expect(rows.find((r) => r.entityType === "USER_PROFILE")?.userId).toBe(oldId);
  expect(rows.find((r) => r.entityType === "USER_ORG_ACCESS")?.role).toBe(
    "ACCOUNTANT",
  );
});
test("oversized migration fails with no writes", async () => {
  for (let i = 0; i < 50; i++)
    rows.push({
      ...rows[2],
      PK: K.orgKey(`org-${i + 2}`),
      orgId: `org-${i + 2}`,
    });
  await expect(apply()).rejects.toThrow("TRANSACTION_LIMIT_EXCEEDED_NO_WRITES");
  expect(ddb.commandCalls(TransactWriteItemsCommand)).toHaveLength(0);
});
test("discovers paginated base-table records including inactive memberships missing GSI6", async () => {
  const inactive = {
    ...rows[2],
    PK: K.orgKey("inactive"),
    orgId: "inactive",
    status: "DISABLED",
  };
  delete (inactive as Row).GSI6PK;
  delete (inactive as Row).GSI6SK;
  rows.push(inactive);
  ddb
    .on(ScanCommand)
    .resolvesOnce({
      Items: rows.slice(0, 2).map((r) => marshall(r)),
      LastEvaluatedKey: marshall({ PK: "cursor", SK: "cursor" }),
    })
    .resolvesOnce({ Items: rows.slice(2).map((r) => marshall(r)) });
  const result = await apply();
  expect(result.memberships).toHaveLength(2);
  expect(
    rows.find(
      (r) => r.orgId === "inactive" && r.entityType === "USER_ORG_ACCESS",
    )?.GSI6SK,
  ).toBe(K.userWorkspaceSK("DISABLED", "inactive"));
});
test("migrates cabinet ownership, assignments and responsibility GSIs; preserves actor history", async () => {
  rows.push(
    {
      PK: K.cabinetPK("cab"),
      SK: K.cabinetMetadataSK(),
      entityType: "CABINET",
      cabinetId: "cab",
      ownerUserId: oldId,
      createdAt: now,
    },
    {
      PK: K.cabinetPK("cab"),
      SK: K.cabinetMemberDossierAssignmentSK(oldId, "org-1"),
      entityType: "CABINET_DOSSIER_ASSIGNMENT",
      cabinetOrgId: "cab",
      dossierOrgId: "org-1",
      userId: oldId,
      assignedBy: oldId,
      assignedAt: now,
      GSI1PK: K.cabinetDossierAssignmentsGSI_PK("cab", "org-1"),
      GSI1SK: K.cabinetDossierAssignmentsGSI_SK(oldId),
    },
    {
      PK: K.cabinetPK("cab"),
      SK: K.cabinetWorkSK("work"),
      entityType: "ACCOUNTING_WORK",
      cabinetOrgId: "cab",
      workId: "work",
      responsibleUserId: oldId,
      createdBy: oldId,
      GSI3PK: K.cabinetResponsibleWorksGSI_PK("cab", oldId),
      GSI3SK: K.cabinetWorkGSI_SK(undefined, "work"),
    },
    {
      PK: K.cabinetPK("cab"),
      SK: K.cabinetDeadlineSK("deadline"),
      entityType: "CABINET_DEADLINE",
      cabinetOrgId: "cab",
      deadlineId: "deadline",
      dueDate: "2026-01-01",
      responsibleUserId: oldId,
      createdBy: oldId,
      GSI3PK: K.cabinetResponsibleDeadlinesGSI_PK("cab", oldId),
      GSI3SK: K.cabinetDeadlineGSI_SK("2026-01-01", "deadline"),
    },
    {
      PK: K.cabinetPK("cab"),
      SK: K.cabinetInvitationSK("invite"),
      entityType: "CABINET_INVITATION",
      acceptedByUserId: oldId,
    },
  );
  await apply();
  expect(rows.find((r) => r.entityType === "CABINET")?.ownerUserId).toBe(newId);
  expect(
    rows.find((r) => r.entityType === "CABINET_DOSSIER_ASSIGNMENT"),
  ).toMatchObject({
    userId: newId,
    assignedBy: oldId,
    GSI1SK: K.cabinetDossierAssignmentsGSI_SK(newId),
  });
  expect(rows.find((r) => r.entityType === "ACCOUNTING_WORK")).toMatchObject({
    responsibleUserId: newId,
    createdBy: oldId,
    GSI3PK: K.cabinetResponsibleWorksGSI_PK("cab", newId),
  });
  expect(rows.find((r) => r.entityType === "CABINET_DEADLINE")?.GSI3PK).toBe(
    K.cabinetResponsibleDeadlinesGSI_PK("cab", newId),
  );
  expect(
    rows.find((r) => r.entityType === "CABINET_INVITATION")?.acceptedByUserId,
  ).toBe(oldId);
});
test("apply requires maintenance and production acknowledgement", async () => {
  await expect(run({ apply: true })).rejects.toThrow(
    "IDENTITY_WRITERS_MUST_BE_PAUSED",
  );
  await expect(
    run({
      stage: "prod",
      tableName: "liass-ohada-prod-accounting-table",
      apply: true,
      maintenanceConfirmed: true,
    }),
  ).rejects.toThrow("PRODUCTION_ACKNOWLEDGEMENT_REQUIRED");
  expect(ddb.commandCalls(TransactWriteItemsCommand)).toHaveLength(0);
});
test("validates pool/table stage and account", async () => {
  cognito.on(DescribeUserPoolCommand).resolves({
    UserPool: {
      Name: "liass-ohada-prod-users",
      Arn: "arn:aws:cognito-idp:eu-west-3:456:userpool/test",
    },
  });
  await expect(run()).rejects.toThrow("TARGET_ENVIRONMENT_MISMATCH");
});
test("CLI defaults to dry run and rejects missing or ambiguous arguments", () => {
  const args = [
    "--old-user-id",
    oldId,
    "--new-user-id",
    newId,
    "--email",
    options.email,
    "--stage",
    "dev",
    "--table-name",
    options.tableName,
    "--user-pool-id",
    options.userPoolId,
    "--region",
    options.region,
  ];
  expect(parseRelinkArgs(args).apply).toBe(false);
  expect(parseRelinkArgs([...args, "--apply"]).apply).toBe(true);
  expect(() =>
    parseRelinkArgs([...args, "--email", "other@example.com"]),
  ).toThrow("Duplicate");
  expect(() => parseRelinkArgs([])).toThrow("required");
});
test("raw binary/set attributes and original timestamps are retained", () => {
  const items = rows.map((r) => marshall(r));
  items[0].tags = { SS: ["one", "two"] };
  items[0].binary = { B: new Uint8Array([1, 2]) };
  const result = planRelink(options, items);
  const migrated = result.writes.find(
    (w) => w.Put?.Item?.entityType.S === "USER_PROFILE",
  )!.Put!.Item!;
  expect(migrated.tags).toEqual(items[0].tags);
  expect(migrated.binary).toEqual(items[0].binary);
  expect(migrated.createdAt).toEqual(items[0].createdAt);
});

test.each([
  [
    "old profile disappearing",
    () => {
      rows.shift();
    },
  ],
  [
    "email ownership changing",
    () => {
      rows[1].userId = "third-user";
    },
  ],
  [
    "new profile appearing",
    () => {
      rows.push({ ...rows[0], PK: K.userProfilePK(newId), userId: newId });
    },
  ],
  [
    "new membership appearing",
    () => {
      rows.push({ ...rows[2], SK: K.orgUserAccessSK(newId), userId: newId });
    },
  ],
])("transaction guards %s after inspection", async (_, mutate) => {
  let expected: Row[] = [];
  cognito.on(AdminGetUserCommand).callsFake(() => {
    if (cognito.commandCalls(AdminGetUserCommand).length === 2) {
      mutate();
      expected = structuredClone(rows);
    }
    return { Enabled: true, UserAttributes: attributes() };
  });
  await expect(apply()).rejects.toThrow("conditional failure");
  expect(rows).toEqual(expected);
});

test("size guard ignores unrelated large business records but blocks large identity images", async () => {
  rows.push({
    PK: K.orgKey("other"),
    SK: "BUSINESS",
    entityType: "BUSINESS",
    content: "x".repeat(310_000),
  });
  await expect(run()).resolves.toMatchObject({ validations: "PASSED" });
  rows[0].extra = "x".repeat(310_000);
  await expect(apply()).rejects.toThrow("TRANSACTION_LIMIT_EXCEEDED_NO_WRITES");
  expect(ddb.commandCalls(TransactWriteItemsCommand)).toHaveLength(0);
});

test("preserves immutable financial actor attribution without rewriting business records", async () => {
  const financial = [
    {
      PK: K.orgKey("org-1"),
      SK: K.salesInvoiceSK("invoice"),
      entityType: "SALES_INVOICE",
      issuedByUserId: oldId,
      totalMinor: 1200,
    },
    {
      PK: K.orgKey("org-1"),
      SK: K.salesPaymentSK("invoice", "payment"),
      entityType: "SALES_PAYMENT",
      recordedByUserId: oldId,
      amountMinor: 1200,
    },
    {
      PK: K.orgKey("org-1"),
      SK: K.salesInvoiceDocumentSK("invoice"),
      entityType: "SALES_INVOICE_DOCUMENT",
      generatedByUserId: oldId,
    },
  ];
  rows.push(...financial);
  const result = await apply();
  expect(result.historicalReferencesPreserved).toMatchObject({
    "SALES_INVOICE.issuedByUserId": 1,
    "SALES_PAYMENT.recordedByUserId": 1,
    "SALES_INVOICE_DOCUMENT.generatedByUserId": 1,
  });
  for (const record of financial)
    expect(rows.find((r) => sameKey(r, record))).toEqual(record);
  expect(result.transactionActions).toBe(8);
});
