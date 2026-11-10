import {
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  QueryCommand,
  TransactWriteItemsCommand,
} from "@aws-sdk/client-dynamodb";
import {
  SSMClient,
  PutParameterCommand,
  GetParameterCommand,
} from "@aws-sdk/client-ssm";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { mockClient } from "aws-sdk-client-mock";
import {
  fiscalEnvironmentForStage,
  handler,
} from "@/lambda/domains/identity/organization-fiscal-handler";
import { KeyFactory as K } from "@/lambda/shared/key-builder";
import type { APIGatewayProxyEventV2WithJWTAuthorizer as Event } from "aws-lambda";

const db = mockClient(DynamoDBClient),
  secrets = mockClient(SSMClient);
const sub = "2189c04e-00f1-702c-d8e5-c38569e8974e";
const connectionId = "98e6dc23-3847-423b-97c4-a3f7e0d1fab5";
const command = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const issuer = "https://cognito-idp.eu-west-3.amazonaws.com/eu-west-3_test";
const token = "eyJhbGciOiJSUzI1NiJ9.eyJ0ZXN0Ijp0cnVlfQ.c3ludGhldGlj";
const base = {
  label: "Test connection",
  environment: "TEST",
  taxpayerIfu: "synthetic-ifu",
  nim: "synthetic-nim",
  expectedVersion: 0,
  commandId: command(1),
};
let rows: Map<string, Record<string, unknown>>, parameters: Map<string, string>;
test.each([
  ["dev", "TEST"],
  ["test", "TEST"],
  ["prod", "PRODUCTION"],
] as const)("stage %s fixes customer fiscality to %s", (stage, expected) => {
  expect(fiscalEnvironmentForStage(stage)).toBe(expected);
});
const key = (row: Record<string, unknown>) => JSON.stringify([row.PK, row.SK]);
const member = (orgId = "org-a", overrides: Record<string, unknown> = {}) => ({
  PK: K.orgKey(orgId),
  SK: K.orgUserAccessSK(sub),
  entityType: "USER_ORG_ACCESS",
  orgId,
  userId: sub,
  status: "ACTIVE",
  role: "OWNER",
  workspaceType: "COMPANY",
    country: "BJ",
  accessSource: "DIRECT",
  ...overrides,
});
const event = (
  method = "PUT",
  suffix = "",
  body: unknown = base,
  orgId = "org-a",
) =>
  ({
    routeKey:
      method === "GET"
        ? "GET /me/organization/fiscality/connections"
        : `${method} /me/organization/fiscality/connections/{connectionId}${suffix}`,
    headers: { "x-org-id": orgId },
    pathParameters: { connectionId },
    queryStringParameters: { environment: "TEST" },
    body: JSON.stringify(body),
    requestContext: { authorizer: { jwt: { claims: { iss: issuer, sub } } } },
  }) as unknown as Event;
const parse = (result: { body: string }) => JSON.parse(result.body);
beforeEach(() => {
  process.env.STAGE = "dev";
  process.env.PLATFORM_COGNITO_ISSUER = issuer;
  db.reset();
  secrets.reset();
  rows = new Map();
  parameters = new Map();
  rows.set(key(member()), member());
  db.on(GetItemCommand).callsFake((input) => {
    const row = rows.get(key(unmarshall(input.Key)));
    return row ? { Item: marshall(row, { removeUndefinedValues: true }) } : {};
  });
  db.on(QueryCommand).callsFake((input) => {
    const values = unmarshall(input.ExpressionAttributeValues);
    return {
      Items: [...rows.values()]
        .filter(
          (row) =>
            row.PK === values[":pk"] &&
            String(row.SK).startsWith(values[":prefix"]),
        )
        .map((row) => marshall(row, { removeUndefinedValues: true })),
    };
  });
  db.on(PutItemCommand).callsFake((input) => {
    const row = unmarshall(input.Item);
    if (rows.has(key(row)))
      throw Object.assign(new Error(), {
        name: "ConditionalCheckFailedException",
      });
    rows.set(key(row), row);
    return {};
  });
  db.on(TransactWriteItemsCommand).callsFake((input) => {
    for (const operation of input.TransactItems)
      if (operation.Put) {
        const row = unmarshall(operation.Put.Item),
          old = rows.get(key(row));
        if (
          operation.Put.ConditionExpression === "attribute_not_exists(PK)" &&
          old
        )
          throw Object.assign(new Error(), {
            name: "TransactionCanceledException",
            CancellationReasons: [{ Code: "ConditionalCheckFailed" }],
          });
      }
    for (const operation of input.TransactItems)
      if (operation.Put) {
        const row = unmarshall(operation.Put.Item);
        rows.set(key(row), row);
      }
    return {};
  });
  secrets.on(PutParameterCommand).callsFake((input) => {
    if (parameters.has(input.Name))
      throw Object.assign(new Error(), { name: "ParameterAlreadyExists" });
    parameters.set(input.Name, input.Value);
    return { Version: 1 };
  });
  secrets.on(GetParameterCommand).callsFake((input) => ({
    Parameter: { Type: "SecureString", Value: parameters.get(input.Name) },
  }));
});
test("tenant creates metadata with optimistic version, immutable audit and no approval authority", async () => {
  const result = await handler(event());
  expect(result.statusCode).toBe(200);
  expect(parse(result).data).toMatchObject({
    version: 1,
    credentialStatus: "ABSENT",
    environment: "TEST",
  });
  const tx = db.commandCalls(TransactWriteItemsCommand)[0].args[0].input
    .TransactItems!;
  expect(tx).toHaveLength(4);
  expect(tx[0].ConditionCheck!.ConditionExpression).toContain(
    "accessSource = :direct",
  );
  expect(tx[2].Put!.ConditionExpression).toBe("attribute_not_exists(PK)");
  expect(
    (
      await handler(
        event("PUT", "", {
          ...base,
          approvalEvidence: { reference: "fabricated" },
        }),
      )
    ).statusCode,
  ).toBe(400);
});
test.each([
  { role: "MEMBER" },
  { role: "CABINET_ADMIN", accessSource: "CABINET" },
  { status: "DISABLED" },
  { workspaceType: "ACCOUNTING_FIRM" },
  { country: "TG" },
  { accessSource: "CABINET" },
  { accessSource: undefined },
])(
  "unauthorized credential management fails before storage %j",
  async (overrides) => {
    rows.set(key(member()), member("org-a", overrides));
    const result = await handler(
      event("PUT", "/credential", {
        environment: "TEST",
        token,
        expectedVersion: 1,
        commandId: command(2),
      }),
    );
    expect(result.statusCode).toBe(403);
    expect(secrets.commandCalls(PutParameterCommand)).toHaveLength(0);
  },
);
test("organization A cannot configure or read B", async () => {
  expect((await handler(event("PUT", "", base, "org-b"))).statusCode).toBe(403);
  expect((await handler(event("GET", "", {}, "org-b"))).statusCode).toBe(403);
  expect(db.commandCalls(QueryCommand)).toHaveLength(0);
});
test("authorized OWNER with a Cognito-issued subject can read fiscal connections", async () => {
  const result = await handler(event("GET", "", {}));
  expect(result.statusCode).toBe(200);
  expect(parse(result).data).toMatchObject({
    canManage: true,
    connections: [],
  });
});
test("secret submission stores Standard SecureString, exposes masked status and never implies readiness", async () => {
  await handler(event());
  const result = await handler(
    event("PUT", "/credential", {
      environment: "TEST",
      expectedVersion: 1,
      commandId: command(2),
      token,
    }),
  );
  expect(result.statusCode).toBe(200);
  expect(parse(result).data).toMatchObject({
    version: 2,
    credentialStatus: "STORED_UNVERIFIED",
  });
  expect(
    secrets.commandCalls(PutParameterCommand)[0].args[0].input,
  ).toMatchObject({
    Type: "SecureString",
    Tier: "Standard",
    Overwrite: false,
    KeyId: "alias/aws/ssm",
  });
  const read = await handler(event("GET"));
  expect(parse(read).data.readiness).toMatchObject({
    state: "PENDING_VERIFICATION",
    providerAuthentication: "UNVERIFIED",
    productionEligible: false,
    issuanceEligible: false,
  });
  expect(read.body).not.toContain("secretReference");
  expect(read.body).not.toContain(token);
  expect(JSON.stringify([...rows.values()])).not.toContain(token);
});
test.each([
  undefined,
  "",
  " ",
  "not-a-jwt",
  "a.b.c\n",
  "a".repeat(4096) + ".b.c",
])(
  "missing/malformed/oversized token is rejected without storage",
  async (value) => {
    await handler(event());
    const result = await handler(
      event("PUT", "/credential", {
        environment: "TEST",
        expectedVersion: 1,
        commandId: command(2),
        token: value,
      }),
    );
    expect(result.statusCode).toBe(400);
    expect(secrets.commandCalls(PutParameterCommand)).toHaveLength(0);
    expect(result.body).not.toContain("a".repeat(100));
  },
);
test("replacement and local revocation preserve old immutable revisions", async () => {
  await handler(event());
  await handler(
    event("PUT", "/credential", {
      environment: "TEST",
      expectedVersion: 1,
      commandId: command(2),
      token,
    }),
  );
  await handler(
    event("PUT", "/credential", {
      environment: "TEST",
      expectedVersion: 2,
      commandId: command(3),
      token: "a.b.replacement",
    }),
  );
  const result = await handler(
    event("DELETE", "/credential", {
      environment: "TEST",
      expectedVersion: 3,
      commandId: command(4),
    }),
  );
  expect(parse(result).data).toMatchObject({
    version: 4,
    credentialStatus: "REVOKED",
  });
  expect(parameters.size).toBe(2);
  const current = rows.get(
    key({
      PK: K.orgKey("org-a"),
      SK: K.organizationFiscalConnectionSK("TEST", connectionId),
    }),
  );
  expect(current).not.toHaveProperty("secretReference");
  expect(
    [...rows.values()].filter(
      (row) => row.entityType === "PLATFORM_FISCAL_HISTORY",
    ),
  ).toHaveLength(4);
});
test("DEV stage rejects a customer-selected PRODUCTION environment before secret storage", async () => {
  await handler(event());
  const result = await handler(
    event("PUT", "/credential", {
      environment: "PRODUCTION",
      expectedVersion: 1,
      commandId: command(2),
      token,
    }),
  );
  expect(result.statusCode).toBe(400);
  expect(parameters.size).toBe(0);
});
test("stale configuration version cannot store a credential", async () => {
  await handler(event());
  expect(
    (
      await handler(
        event("PUT", "/credential", {
          environment: "TEST",
          expectedVersion: 0,
          commandId: command(2),
          token,
        }),
      )
    ).statusCode,
  ).toBe(409);
  expect(parameters.size).toBe(0);
});
test("changed taxpayer identity removes credential association", async () => {
  await handler(event());
  await handler(
    event("PUT", "/credential", {
      environment: "TEST",
      expectedVersion: 1,
      commandId: command(2),
      token,
    }),
  );
  const response = await handler(
    event("PUT", "", {
      ...base,
      taxpayerIfu: "different",
      expectedVersion: 2,
      commandId: command(3),
    }),
  );
  expect(parse(response).data.credentialStatus).toBe("ABSENT");
});
test("ambiguous SSM write is recoverable with the same command, never overwrite", async () => {
  await handler(event());
  let first = true;
  secrets.on(PutParameterCommand).callsFake((input) => {
    if (first) {
      first = false;
      parameters.set(input.Name, input.Value);
      throw new Error("private AWS diagnostic includes token " + token);
    }
    throw Object.assign(new Error(), { name: "ParameterAlreadyExists" });
  });
  const request = event("PUT", "/credential", {
    environment: "TEST",
    expectedVersion: 1,
    commandId: command(2),
    token,
  });
  const failure = await handler(request);
  expect(failure.statusCode).toBe(503);
  expect(failure.body).not.toContain(token);
  expect(
    parse(await handler(event("GET"))).data.connections[0].credentialStatus,
  ).toBe("ABSENT");
  expect((await handler(request)).statusCode).toBe(200);
  expect(parameters.size).toBe(1);
  expect(secrets.commandCalls(GetParameterCommand)).toHaveLength(1);
});
test("same pending command with a different token conflicts before provider storage", async () => {
  await handler(event());
  secrets.on(PutParameterCommand).rejects(new Error("Timeout"));
  await handler(
    event("PUT", "/credential", {
      environment: "TEST",
      expectedVersion: 1,
      commandId: command(2),
      token,
    }),
  );
  expect(
    (
      await handler(
        event("PUT", "/credential", {
          environment: "TEST",
          expectedVersion: 1,
          commandId: command(2),
          token: "different.b.c",
        }),
      )
    ).statusCode,
  ).toBe(409);
  expect(secrets.commandCalls(PutParameterCommand)).toHaveLength(1);
});
test("replay returns the established configuration and does not re-store credentials", async () => {
  await handler(event());
  const request = event("PUT", "/credential", {
    environment: "TEST",
    expectedVersion: 1,
    commandId: command(2),
    token,
  });
  const first = await handler(request),
    second = await handler(request);
  expect(parse(second).data).toEqual(parse(first).data);
  expect(secrets.commandCalls(PutParameterCommand)).toHaveLength(1);
});
test("foreign cursor is rejected, no Scan or provider operation occurs", async () => {
  const request = event("GET");
  request.queryStringParameters!.cursor = Buffer.from(
    JSON.stringify({
      PK: K.orgKey("org-b"),
      SK: K.organizationFiscalConnectionSK("TEST", connectionId),
    }),
  ).toString("base64url");
  expect((await handler(request)).statusCode).toBe(400);
  expect(db.commandCalls(QueryCommand)).toHaveLength(0);
  expect(
    db
      .commandCalls(GetItemCommand)
      .every((call) => call.args[0].input.ConsistentRead),
  ).toBe(true);
});

test("membership revocation racing credential commit prevents activation of the stored secret", async () => {
  await handler(event());
  db.on(TransactWriteItemsCommand).callsFake(() => {
    rows.set(key(member()), member("org-a", { role: "MEMBER" }));
    throw Object.assign(new Error(), {
      name: "TransactionCanceledException",
      CancellationReasons: [{ Code: "ConditionalCheckFailed" }],
    });
  });
  expect(
    (
      await handler(
        event("PUT", "/credential", {
          environment: "TEST",
          expectedVersion: 1,
          commandId: command(2),
          token,
        }),
      )
    ).statusCode,
  ).toBe(403);
  expect(
    parse(await handler(event("GET"))).data.connections[0].credentialStatus,
  ).toBe("ABSENT");
});

test("a pre-existing parameter with different bytes is never accepted as this command's credential", async () => {
  await handler(event());
  secrets
    .on(PutParameterCommand)
    .rejects(Object.assign(new Error(), { name: "ParameterAlreadyExists" }));
  secrets
    .on(GetParameterCommand)
    .resolves({ Parameter: { Type: "SecureString", Value: "different.b.c" } });
  expect(
    (
      await handler(
        event("PUT", "/credential", {
          environment: "TEST",
          expectedVersion: 1,
          commandId: command(2),
          token,
        }),
      )
    ).statusCode,
  ).toBe(503);
  expect(
    parse(await handler(event("GET"))).data.connections[0].credentialStatus,
  ).toBe("ABSENT");
});

test("lost credential-commit response resolves its durable result without another SSM write", async () => {
  await handler(event());
  db.on(TransactWriteItemsCommand).callsFake((input) => {
    for (const operation of input.TransactItems)
      if (operation.Put) {
        const row = unmarshall(operation.Put.Item);
        rows.set(key(row), row);
      }
    throw new Error("Timeout after commit");
  });
  const request = event("PUT", "/credential", {
    environment: "TEST",
    expectedVersion: 1,
    commandId: command(2),
    token,
  });
  expect((await handler(request)).statusCode).toBe(200);
  expect((await handler(request)).statusCode).toBe(200);
  expect(secrets.commandCalls(PutParameterCommand)).toHaveLength(1);
});
