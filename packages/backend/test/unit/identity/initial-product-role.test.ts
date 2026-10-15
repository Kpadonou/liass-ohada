import { randomUUID } from "crypto";
import {
  DynamoDBClient,
  GetItemCommand,
  QueryCommand,
  ScanCommand,
  TransactWriteItemsCommand,
  TransactWriteItemsCommandInput,
  TransactionCanceledException,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { mockClient } from "aws-sdk-client-mock";
import { handler } from "@/lambda/domains/identity/assign-initial-product-role";
import { InitialProductRoleService as S } from "@/lambda/shared/services/initial-product-role-service";
import { TenantAccessService } from "@/lambda/shared/services/tenant-access-service";
import { DomainAuthorizationService } from "@/lambda/shared/services/domain-authorization-service";
import { config } from "@/lambda/shared/config";
import { KeyFactory as K } from "@/lambda/shared/key-builder";
import {
  AssignInitialProductRoleRequestSchema,
  AssignInitialProductRoleResponseSchema,
} from "@liass-ohada/shared/shared";

type Row = Record<string, unknown>;
const org = "org-company",
  owner = "owner",
  target = "member";
const rows = new Map<string, Row>();
const db = mockClient(DynamoDBClient);
let beforeCommit: (() => void) | undefined;
const key = (row: Row) => JSON.stringify([row.PK, row.SK]);
const get = (SK: string, orgId = org) =>
  rows.get(key({ PK: K.orgKey(orgId), SK }))!;
const seed = (SK: string, data: Row, orgId = org) =>
  rows.set(key({ PK: K.orgKey(orgId), SK }), {
    PK: K.orgKey(orgId),
    SK,
    orgId,
    ...data,
  });
function seedMember(userId: string, data: Row = {}, orgId = org) {
  seed(
    K.orgUserAccessSK(userId),
    {
      entityType: "USER_ORG_ACCESS",
      userId,
      status: "ACTIVE",
      workspaceType: "COMPANY",
      accessSource: "DIRECT",
      role: "MEMBER",
      ...data,
    },
    orgId,
  );
}
function seedOrg(orgId = org) {
  seed(
    K.organizationSK(),
    { entityType: "ORGANIZATION", workspaceType: "COMPANY", status: "ACTIVE" },
    orgId,
  );
  seed(
    K.productAccessSK("RESTAURANTS"),
    {
      entityType: "PRODUCT_ACCESS",
      productCode: "RESTAURANTS",
      status: "ACTIVE",
      createdAt: "2026-10-15T00:00:00.000Z",
      updatedAt: "2026-10-15T00:00:00.000Z",
    },
    orgId,
  );
}
const request = (overrides: Row = {}) => ({
  clientRequestId: randomUUID(),
  memberUserId: target,
  productCode: "RESTAURANTS",
  role: "WAITER",
  ...overrides,
});
const assign = (input: Row = request(), actor = owner, tenant = org) =>
  S.assign(tenant, actor, input);
const auditRows = () =>
  [...rows.values()].filter(
    (row) => row.entityType === "PRODUCT_ROLE_ASSIGNMENT_AUDIT",
  );

// Evaluate the real repository expressions and commit all writes only if every guard passes.
function split(expression: string, separator: string): string[] {
  let depth = 0,
    start = 0;
  const parts: string[] = [];
  for (let index = 0; index < expression.length; index++) {
    if (expression[index] === "(") depth++;
    if (expression[index] === ")") depth--;
    if (!depth && expression.startsWith(separator, index)) {
      parts.push(expression.slice(start, index));
      start = index + separator.length;
    }
  }
  parts.push(expression.slice(start));
  return parts;
}
function readPath(
  row: Row,
  path: string,
  names: Record<string, string>,
): unknown {
  return path
    .split(".")
    .reduce<unknown>(
      (value, part) =>
        value && typeof value === "object"
          ? (value as Row)[names[part] ?? part]
          : undefined,
      row,
    );
}
function condition(
  row: Row,
  expression: string,
  names: Record<string, string>,
  values: Row,
): boolean {
  const and = split(expression, " AND ");
  if (and.length > 1)
    return and.every((part) => condition(row, part, names, values));
  if (expression.startsWith("(") && expression.endsWith(")"))
    return condition(row, expression.slice(1, -1), names, values);
  const or = split(expression, " OR ");
  if (or.length > 1)
    return or.some((part) => condition(row, part, names, values));
  const absent = /^attribute_not_exists\((.+)\)$/.exec(expression);
  if (absent) return readPath(row, absent[1], names) === undefined;
  const match = /^([\w.#]+) = (:\w+)$/.exec(expression);
  if (!match) throw new Error(`Unsupported test expression ${expression}`);
  return (
    JSON.stringify(readPath(row, match[1], names)) ===
    JSON.stringify(values[match[2]])
  );
}
function commit(input: TransactWriteItemsCommandInput) {
  beforeCommit?.();
  beforeCommit = undefined;
  const actions = input.TransactItems ?? [];
  const seen = new Set<string>();
  for (const operation of actions) {
    const action =
      operation.Update ?? operation.Put ?? operation.ConditionCheck;
    if (!action) throw new Error("Unexpected write");
    expect(action.TableName).toBe(config.PLATFORM_TABLE_NAME);
    const itemKey = key(
      unmarshall(
        operation.Put?.Item ??
          operation.Update?.Key ??
          operation.ConditionCheck!.Key!,
      ),
    );
    if (seen.has(itemKey)) throw new Error("Duplicate transaction item");
    seen.add(itemKey);
    if (
      !condition(
        rows.get(itemKey) ?? {},
        action.ConditionExpression!,
        action.ExpressionAttributeNames ?? {},
        unmarshall(action.ExpressionAttributeValues ?? {}),
      )
    )
      throw new TransactionCanceledException({
        message: "Conflict",
        $metadata: {},
        CancellationReasons: [{ Code: "ConditionalCheckFailed" }],
      });
  }
  for (const operation of actions) {
    if (operation.Put) {
      const row = unmarshall(operation.Put.Item!);
      rows.set(key(row), row);
    }
    if (operation.Update) {
      const op = operation.Update;
      const row = structuredClone(rows.get(key(unmarshall(op.Key!)))!);
      const names = op.ExpressionAttributeNames ?? {};
      const values = unmarshall(op.ExpressionAttributeValues!);
      for (const part of op.UpdateExpression!.slice(4).split(", ")) {
        const [path, token] = part.split(" = ");
        const segments = path
          .split(".")
          .map((segment) => names[segment] ?? segment);
        let nested = row;
        for (const segment of segments.slice(0, -1))
          nested = nested[segment] as Row;
        nested[segments.at(-1)!] = values[token];
      }
      rows.set(key(row), row);
    }
  }
  return {};
}
beforeEach(() => {
  db.reset();
  rows.clear();
  beforeCommit = undefined;
  seedOrg();
  seedMember(owner, { role: "OWNER", productRoles: { RESTAURANTS: "OWNER" } });
  seedMember(target);
  db.on(GetItemCommand).callsFake((input) => {
    const row = rows.get(key(unmarshall(input.Key)));
    return { Item: row ? marshall(row) : undefined };
  });
  db.on(TransactWriteItemsCommand).callsFake(commit);
});
afterAll(() => db.restore());

test.each(["WAITER", "MANAGER", "CASHIER", "KITCHEN"])(
  "initial %s assignment commits membership, durable command and audit together",
  async (role) => {
    const result = await assign(request({ role }));
    expect(result).toEqual({
      userId: target,
      productCode: "RESTAURANTS",
      role,
    });
    expect(get(K.orgUserAccessSK(target)).productRoles).toEqual({
      RESTAURANTS: role,
    });
    expect(auditRows()).toHaveLength(1);
    expect(auditRows()[0]).toMatchObject({
      orgId: org,
      actorUserId: owner,
      targetUserId: target,
      action: "ASSIGN_INITIAL_PRODUCT_ROLE",
      productCode: "RESTAURANTS",
      before: null,
      after: role,
      createdAt: expect.any(String),
    });
    expect(
      db.commandCalls(TransactWriteItemsCommand)[0].args[0].input.TransactItems,
    ).toHaveLength(6);
    expect(
      [...rows.values()].filter(
        (row) => row.entityType === "INITIAL_PRODUCT_ROLE_COMMAND",
      ),
    ).toHaveLength(1);
    expect(get(K.productAccessSK("RESTAURANTS")).updatedAt).toBe(
      "2026-10-15T00:00:00.000Z",
    );
  },
);

test("sets only the absent role entry and preserves unrelated metadata/map entries", async () => {
  seedMember(target, {
    productRoles: { ACCOUNTING: "legacy-accounting-value" },
    GSI6PK: "stable-index",
    custom: "keep",
  });
  await assign();
  expect(get(K.orgUserAccessSK(target))).toMatchObject({
    productRoles: {
      ACCOUNTING: "legacy-accounting-value",
      RESTAURANTS: "WAITER",
    },
    custom: "keep",
    GSI6PK: "stable-index",
    role: "MEMBER",
  });
  const update = db
    .commandCalls(TransactWriteItemsCommand)[0]
    .args[0].input.TransactItems!.find((op) => op.Update)!.Update!;
  expect(update.UpdateExpression).toContain("#roles.#product = :assigned");
  expect(update.UpdateExpression).not.toContain("SET productRoles =");
});

test("canonical authorization consumers immediately resolve the new role without Staff provisioning", async () => {
  await assign();
  const access = await TenantAccessService.assertUserCanAccessOrg({
    orgId: org,
    userId: target,
  });
  expect(access.productRoles?.RESTAURANTS).toBe("WAITER");
  const permissions = DomainAuthorizationService.permissionsForRestaurantsRole(
    access.productRoles?.RESTAURANTS,
  );
  expect(permissions).toContain("RESTAURANTS_SERVICE_FLOOR_READ");
  expect(permissions).not.toContain(
    "RESTAURANTS_SESSION_RESPONSIBILITY_MANAGE",
  );
  expect(
    [...rows.values()].some((row) => row.entityType === "RESTAURANT_STAFF"),
  ).toBe(false);
});

test.each(["MANAGER", "WAITER", "CASHIER", "KITCHEN", "OWNER"])(
  "product role %s does not confer Platform authority",
  async (role) => {
    seedMember(owner, { role: "MEMBER", productRoles: { RESTAURANTS: role } });
    await expect(assign()).rejects.toMatchObject({ statusCode: 403 });
    expect(db.commandCalls(TransactWriteItemsCommand)).toHaveLength(0);
  },
);
test.each(["SUSPENDED", "REVOKED"])(
  "inactive actor %s denied",
  async (status) => {
    get(K.orgUserAccessSK(owner)).status = status;
    await expect(assign()).rejects.toMatchObject({ statusCode: 403 });
  },
);
test.each([
  { status: "SUSPENDED" },
  { status: "REVOKED" },
  { accessSource: "CABINET" },
  { workspaceType: "ACCOUNTING_FIRM" },
  { orgId: "foreign" },
  { userId: "foreign" },
  { entityType: "OTHER" },
])("ineligible target rejected %j", async (change) => {
  Object.assign(get(K.orgUserAccessSK(target)), change);
  await expect(assign()).rejects.toMatchObject({ statusCode: 403 });
  expect(auditRows()).toHaveLength(0);
});
test("missing/foreign target and organization rejected", async () => {
  await expect(
    assign(request({ memberUserId: "foreign-user" })),
  ).rejects.toMatchObject({ statusCode: 403 });
  await expect(assign(request(), owner, "foreign-org")).rejects.toMatchObject({
    statusCode: 403,
  });
  expect(auditRows()).toHaveLength(0);
});
test.each(["INACTIVE", "MISSING", "ACCOUNTING_ONLY"])(
  "requires an active requested entitlement: %s",
  async (state) => {
    if (state === "INACTIVE")
      get(K.productAccessSK("RESTAURANTS")).status = state;
    else rows.delete(key(get(K.productAccessSK("RESTAURANTS"))));
    if (state === "ACCOUNTING_ONLY")
      seed(K.productAccessSK("ACCOUNTING"), {
        entityType: "PRODUCT_ACCESS",
        productCode: "ACCOUNTING",
        status: "ACTIVE",
      });
    await expect(assign()).rejects.toMatchObject({
      statusCode: 403,
      messageCode: "PRODUCT_ACCESS_REQUIRED",
    });
    expect(auditRows()).toHaveLength(0);
  },
);
test.each([{ status: "INACTIVE" }, { workspaceType: "ACCOUNTING_FIRM" }])(
  "invalid organization rejected %j",
  async (change) => {
    Object.assign(get(K.organizationSK()), change);
    await expect(assign()).rejects.toMatchObject({ statusCode: 403 });
  },
);
test("legacy direct membership without accessSource is supported", async () => {
  delete get(K.orgUserAccessSK(owner)).accessSource;
  delete get(K.orgUserAccessSK(target)).accessSource;
  await expect(assign()).resolves.toMatchObject({ role: "WAITER" });
});
test("self-target supports absent non-owner role, preserves bootstrap OWNER and never transfers ownership", async () => {
  delete get(K.orgUserAccessSK(owner)).productRoles;
  await expect(
    assign(request({ memberUserId: owner, role: "MANAGER" })),
  ).resolves.toMatchObject({ role: "MANAGER" });
  expect(get(K.orgUserAccessSK(owner)).role).toBe("OWNER");
  expect(
    db.commandCalls(TransactWriteItemsCommand)[0].args[0].input.TransactItems,
  ).toHaveLength(5);
  seedMember(owner, { role: "OWNER", productRoles: { RESTAURANTS: "OWNER" } });
  await expect(assign(request({ memberUserId: owner }))).rejects.toMatchObject({
    statusCode: 409,
  });
});
test("identical existing role converges without duplicate assignment audit; different role conflicts", async () => {
  seedMember(target, { productRoles: { RESTAURANTS: "WAITER" } });
  await expect(assign()).resolves.toMatchObject({ role: "WAITER" });
  expect(auditRows()).toHaveLength(0);
  await expect(assign(request({ role: "MANAGER" }))).rejects.toMatchObject({
    statusCode: 409,
    messageCode: "PLATFORM_PRODUCT_ROLE_CONFLICT",
  });
  expect(get(K.orgUserAccessSK(target)).productRoles).toEqual({
    RESTAURANTS: "WAITER",
  });
});
test("exact durable replay has no additional writes/audits; changed target/role and actor conflict", async () => {
  const input = request();
  await assign(input);
  const writes = db.commandCalls(TransactWriteItemsCommand).length;
  await expect(assign(input)).resolves.toMatchObject({ role: "WAITER" });
  expect(db.commandCalls(TransactWriteItemsCommand)).toHaveLength(writes);
  seedMember("other-target");
  seedMember("other-owner", { role: "OWNER" });
  for (const changed of [
    { ...input, memberUserId: "other-target" },
    { ...input, role: "MANAGER" },
  ])
    await expect(assign(changed)).rejects.toMatchObject({
      statusCode: 409,
      messageCode: "PLATFORM_PRODUCT_ROLE_IDEMPOTENCY_CONFLICT",
    });
  await expect(assign(input, "other-owner")).rejects.toMatchObject({
    statusCode: 409,
  });
  expect(auditRows()).toHaveLength(1);
});
test("request IDs are tenant-isolated", async () => {
  seedOrg("org-second");
  seedMember(owner, { role: "OWNER" }, "org-second");
  seedMember(target, {}, "org-second");
  const input = request();
  await assign(input);
  await assign(input, owner, "org-second");
  expect(auditRows()).toHaveLength(2);
  expect(new Set(auditRows().map((row) => row.orgId))).toEqual(
    new Set([org, "org-second"]),
  );
});
test("concurrent different roles yield one assignment and one conflict; same roles converge", async () => {
  const results = await Promise.allSettled([
    assign(),
    assign(request({ role: "MANAGER" })),
  ]);
  expect(
    results.filter((result) => result.status === "fulfilled"),
  ).toHaveLength(1);
  expect(results.filter((result) => result.status === "rejected")).toHaveLength(
    1,
  );
  expect(auditRows()).toHaveLength(1);
  seedMember(target);
  rows.clear();
  seedOrg();
  seedMember(owner, { role: "OWNER" });
  seedMember(target);
  const same = await Promise.allSettled([assign(), assign()]);
  expect(same.every((result) => result.status === "fulfilled")).toBe(true);
  expect(auditRows()).toHaveLength(1);
});
test.each(["actor", "target", "entitlement", "organization"])(
  "revocation of %s during request prevents all business writes",
  async (subject) => {
    beforeCommit = () => {
      if (subject === "actor") get(K.orgUserAccessSK(owner)).role = "MEMBER";
      if (subject === "target")
        get(K.orgUserAccessSK(target)).status = "REVOKED";
      if (subject === "entitlement")
        get(K.productAccessSK("RESTAURANTS")).status = "INACTIVE";
      if (subject === "organization")
        get(K.organizationSK()).status = "INACTIVE";
    };
    await expect(assign()).rejects.toMatchObject({ statusCode: 403 });
    expect(get(K.orgUserAccessSK(target)).productRoles).toBeUndefined();
    expect(auditRows()).toHaveLength(0);
    expect(
      [...rows.values()].some(
        (row) => row.entityType === "INITIAL_PRODUCT_ROLE_COMMAND",
      ),
    ).toBe(false);
  },
);
test("role map concurrently initialized for another product is preserved on bounded retry", async () => {
  beforeCommit = () => {
    get(K.orgUserAccessSK(target)).productRoles = { SALES: "future-value" };
  };
  await assign();
  expect(get(K.orgUserAccessSK(target)).productRoles).toEqual({
    SALES: "future-value",
    RESTAURANTS: "WAITER",
  });
  expect(auditRows()).toHaveLength(1);
});
test("bounded direct strongly consistent reads, no Scan/Query/GSI and no unrelated writes", async () => {
  await assign();
  expect(db.commandCalls(QueryCommand)).toHaveLength(0);
  expect(db.commandCalls(ScanCommand)).toHaveLength(0);
  expect(db.commandCalls(GetItemCommand)).toHaveLength(5);
  expect(
    db
      .commandCalls(GetItemCommand)
      .every((call) => call.args[0].input.ConsistentRead === true),
  ).toBe(true);
  const operations = db.commandCalls(TransactWriteItemsCommand)[0].args[0].input
    .TransactItems!;
  const writeSKs = operations.flatMap((op) =>
    op.Update ? [op.Update.Key!.SK.S] : op.Put ? [op.Put.Item!.SK.S] : [],
  );
  expect(
    writeSKs.every(
      (SK) =>
        SK === K.orgUserAccessSK(target) || SK?.startsWith("PRODUCT_ROLE_"),
    ),
  ).toBe(true);
});

test.each([
  { productCode: "ACCOUNTING", role: "WAITER" },
  { productCode: "SALES", role: "MANAGER" },
  { productCode: "OTHER" },
  { role: "ACCOUNTANT" },
  { role: "OWNER" },
  { role: "ADMIN" },
  { clientRequestId: "invalid" },
  { actorRole: "OWNER" },
  { orgId: "forged" },
  { actorId: "forged" },
  { sub: "forged" },
])(
  "strict request refuses invalid/protected pair and forged fields %j",
  async (overrides) => {
    const input = request(overrides);
    expect(AssignInitialProductRoleRequestSchema.safeParse(input).success).toBe(
      false,
    );
    await expect(assign(input)).rejects.toHaveProperty("name", "ZodError");
    expect(auditRows()).toHaveLength(0);
  },
);
test("response is strict and no provider, staff, unrelated roles or key metadata is exposed", () => {
  const result = { userId: target, productCode: "RESTAURANTS", role: "WAITER" };
  expect(AssignInitialProductRoleResponseSchema.parse(result)).toEqual(result);
  for (const field of [
    "PK",
    "sub",
    "productRoles",
    "staff",
    "outlets",
    "actorRole",
  ])
    expect(
      AssignInitialProductRoleResponseSchema.safeParse({
        ...result,
        [field]: "hidden",
      }).success,
    ).toBe(false);
});
test("HTTP path selects target, body stays minimal and verified tenant/actor remain authoritative", async () => {
  const input = request();
  const response = await handler({
    headers: { "x-org-id": org, "accept-language": "en" },
    requestContext: { authorizer: { jwt: { claims: { sub: owner } } } },
    pathParameters: { memberUserId: target, productCode: "RESTAURANTS" },
    body: JSON.stringify({
      clientRequestId: input.clientRequestId,
      role: "WAITER",
      orgId: "foreign",
      userId: "foreign",
    }),
  });
  expect(response.statusCode).toBe(200);
  expect(JSON.parse(response.body)).toEqual({
    userId: target,
    productCode: "RESTAURANTS",
    role: "WAITER",
  });
});

test("same request concurrent replay and lost response create one audit and one durable command", async () => {
  const input = request();
  const results = await Promise.all([assign(input), assign(input)]);
  expect(results[0]).toEqual(results[1]);
  expect(auditRows()).toHaveLength(1);
  expect(
    [...rows.values()].filter(
      (row) => row.entityType === "INITIAL_PRODUCT_ROLE_COMMAND",
    ),
  ).toHaveLength(1);
  const changedProduct = { ...input, productCode: "ACCOUNTING" };
  await expect(assign(changedProduct)).rejects.toHaveProperty(
    "name",
    "ZodError",
  ); // Unsupported pair is rejected before idempotency lookup.
});

test("ambiguous network result is recoverable with the same request ID", async () => {
  db.on(TransactWriteItemsCommand).callsFake((input) => {
    commit(input);
    throw new Error("Lost response");
  });
  const input = request();
  await expect(assign(input)).rejects.toThrow("Lost response");
  await expect(assign(input)).resolves.toMatchObject({ role: "WAITER" });
  expect(auditRows()).toHaveLength(1);
  expect(db.commandCalls(TransactWriteItemsCommand)).toHaveLength(1);
});

test("durable replay never bypasses revoked membership", async () => {
  const input = request();
  await assign(input);
  get(K.orgUserAccessSK(owner)).status = "REVOKED";
  await expect(assign(input)).rejects.toMatchObject({ statusCode: 403 });
});

test("persistent transaction contention has bounded retries and no partial effect", async () => {
  db.on(TransactWriteItemsCommand).rejects(
    new TransactionCanceledException({
      message: "Conflict",
      $metadata: {},
      CancellationReasons: [{ Code: "TransactionConflict" }],
    }),
  );
  await expect(assign()).rejects.toMatchObject({
    statusCode: 409,
    messageCode: "PLATFORM_PRODUCT_ROLE_WRITE_CONFLICT",
  });
  expect(db.commandCalls(TransactWriteItemsCommand)).toHaveLength(3);
  expect(auditRows()).toHaveLength(0);
  expect(get(K.orgUserAccessSK(target)).productRoles).toBeUndefined();
});

test("invalid stored command fails with a safe server error", async () => {
  const input = request();
  seed(K.organizationProductRoleCommandSK(input.clientRequestId as string), {
    entityType: "INITIAL_PRODUCT_ROLE_COMMAND",
    fingerprint: "bad",
  });
  await expect(assign(input)).rejects.toMatchObject({
    statusCode: 500,
    messageCode: "ERROR_INTERNAL_SERVER",
  });
});

test.each([{ orgId: "foreign" }, { productCode: "ACCOUNTING" }])(
  "mismatched entitlement cannot authorize assignment or replay %j",
  async (change) => {
    Object.assign(get(K.productAccessSK("RESTAURANTS")), change);
    await expect(assign()).rejects.toMatchObject({
      statusCode: 403,
      messageCode: "PRODUCT_ACCESS_REQUIRED",
    });
    expect(auditRows()).toHaveLength(0);
  },
);
