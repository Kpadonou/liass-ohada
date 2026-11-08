import {
  DynamoDBClient,
  GetItemCommand,
  QueryCommand,
  PutItemCommand,
  TransactWriteItemsCommand,
} from "@aws-sdk/client-dynamodb";
import {
  SSMClient,
  GetParameterCommand,
  PutParameterCommand,
} from "@aws-sdk/client-ssm";
import { mockClient } from "aws-sdk-client-mock";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { createHash } from "node:crypto";
import { SubmitFiscalCredentialSchema } from "@liass-ohada/shared/shared";
import { OrganizationFiscalVerificationService } from "@/lambda/shared/services/organization-fiscal-verification-service";
import { OrganizationFiscalRepository } from "@/lambda/shared/repositories/organization-fiscal-repository";
import { OrganizationLegalIdentityService } from "@/lambda/shared/services/organization-legal-identity-service";
import { FiscalComplianceConnectionVerifier } from "@/lambda/domains/fiscal-compliance/connection-verification";
import { KeyFactory as K } from "@/lambda/shared/key-builder";
import { handler } from "@/lambda/domains/identity/organization-fiscal-handler";
import type { FiscalHttpTransport } from "@/lambda/domains/fiscal-compliance/providers/http-transport";
import type { APIGatewayProxyEventV2WithJWTAuthorizer as Event } from "aws-lambda";

const db = mockClient(DynamoDBClient),
  ssm = mockClient(SSMClient);
const org = "org-synthetic",
  sub = "2189c04e-00f1-702c-d8e5-c38569e8974e",
  connectionId = "d9dc2b98-7acf-432c-854e-f9685b79657b";
const issuer = "https://cognito-idp.eu-west-3.amazonaws.com/eu-west-3_test";
const principal = { stage: "dev" as const, issuer, sub };
const token = "a.b.synthetic";
const command = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const reference = `/${principal.stage}/platform/fiscal/${hash(org)}/TEST/${command(1)}`;
const connectionKey = {
  PK: K.orgKey(org),
  SK: K.organizationFiscalConnectionSK("TEST", connectionId),
};
const identityKey = {
  PK: K.orgKey(org),
  SK: K.organizationLegalIdentityCurrentSK(),
};
const membershipKey = { PK: K.orgKey(org), SK: K.orgUserAccessSK(sub) };
const data = {
  environment: "TEST",
  connectionId,
  label: "Synthetic",
  taxpayerIfu: "synthetic-ifu",
  nim: "synthetic-nim",
  version: 1,
  credentialStatus: "STORED_UNVERIFIED",
  updatedAt: "2026-11-07T10:00:00.000Z",
};
const request = (n = 2) => ({
  environment: "TEST",
  connectionId,
  expectedVersion: 1,
  commandId: command(n),
});
const evidence = {
  status: true,
  ifu: data.taxpayerIfu,
  nim: data.nim,
  tokenValid: "2026-11-08T12:00:00Z",
  serverDateTime: "2026-11-07T12:00:00Z",
  emcfList: [{ nim: data.nim }],
};
let rows: Map<string, Record<string, unknown>>, now: string;
const key = (value: Record<string, unknown>) =>
  JSON.stringify([value.PK, value.SK]);
const normalized = (v: unknown): string =>
  v && typeof v === "object" && !Array.isArray(v)
    ? JSON.stringify(
        Object.fromEntries(
          Object.entries(v)
            .sort()
            .map(([k, value]) => [k, normalized(value)]),
        ),
      )
    : JSON.stringify(v);
const equal = (a: unknown, b: unknown) => normalized(a) === normalized(b);
function cancelled(): never {
  throw Object.assign(new Error("Conditional failure"), {
    name: "TransactionCanceledException",
    CancellationReasons: [{ Code: "ConditionalCheckFailed" }],
  });
}
function apply(input: {
  TransactItems?: import("@aws-sdk/client-dynamodb").TransactWriteItem[];
}) {
  for (const operation of input.TransactItems ?? []) {
    const write = operation.Put ?? operation.ConditionCheck;
    if (!write) throw new Error("Unexpected operation");
    const item = operation.Put
      ? unmarshall(operation.Put.Item!)
      : unmarshall(operation.ConditionCheck!.Key!);
    const existing = rows.get(key(item));
    const values = write.ExpressionAttributeValues
      ? unmarshall(write.ExpressionAttributeValues)
      : {};
    if (operation.ConditionCheck) {
      if (
        item.SK === membershipKey.SK &&
        (existing?.status !== "ACTIVE" ||
          existing.role !== "OWNER" ||
          existing.accessSource !== "DIRECT")
      )
        cancelled();
      if (
        item.SK === identityKey.SK &&
        existing?.version !== values[":identityVersion"]
      )
        cancelled();
    } else if (write.ConditionExpression === "attribute_not_exists(PK)") {
      if (existing) cancelled();
    } else if (values[":snapshot"]) {
      if (
        !existing ||
        !equal(existing.data, values[":snapshot"]) ||
        existing.secretReference !== values[":secret"]
      )
        cancelled();
      const revision = (
        existing.verification as { revision?: number } | undefined
      )?.revision;
      if (
        values[":revision"] === undefined
          ? revision !== undefined
          : revision !== values[":revision"]
      )
        cancelled();
    } else if (values[":version"] !== undefined) {
      if (
        (existing?.data as { version?: number } | undefined)?.version !==
        values[":version"]
      )
        cancelled();
    } else if (
      values[":pending"] &&
      (existing?.state ?? existing?.status) !== values[":pending"]
    )
      cancelled();
  }
  for (const operation of input.TransactItems ?? [])
    if (operation.Put) {
      const item = unmarshall(operation.Put.Item!);
      rows.set(key(item), item);
    }
  return {};
}
const transport = jest.fn<
  ReturnType<FiscalHttpTransport>,
  Parameters<FiscalHttpTransport>
>();
const service = () =>
  new OrganizationFiscalVerificationService(
    FiscalComplianceConnectionVerifier.withTransport(transport),
    () => now,
  );
beforeEach(() => {
  db.reset();
  ssm.reset();
  rows = new Map();
  now = "2026-11-07T12:00:00.000Z";
  jest.useFakeTimers({
    now: new Date(now),
    doNotFake: ["setTimeout", "clearTimeout", "nextTick", "queueMicrotask"],
  });
  process.env.STAGE = "dev";
  process.env.PLATFORM_COGNITO_ISSUER = issuer;
  process.env.FISCAL_CREDENTIAL_TEST_VERIFICATION_ENABLED = "1";
  jest
    .spyOn(globalThis, "fetch")
    .mockRejectedValue(new Error("LIVE_NETWORK_FORBIDDEN"));
  transport
    .mockReset()
    .mockResolvedValue({ status: 200, body: JSON.stringify(evidence) });
  rows.set(key(connectionKey), {
    ...connectionKey,
    orgId: org,
    entityType: "PLATFORM_FISCAL_CONNECTION",
    data: structuredClone(data),
    secretReference: reference,
  });
  rows.set(key(membershipKey), {
    ...membershipKey,
    orgId: org,
    userId: sub,
    entityType: "USER_ORG_ACCESS",
    role: "OWNER",
    accessSource: "DIRECT",
    workspaceType: "COMPANY",
    status: "ACTIVE",
  });
  rows.set(key(identityKey), { ...identityKey, version: 1 });
  const storageRequest = SubmitFiscalCredentialSchema.parse({
    ...request(1),
    token,
    expectedVersion: 0,
  });
  rows.set(
    key({
      PK: K.orgKey(org),
      SK: K.organizationFiscalCommandSK("TEST", command(1)),
    }),
    {
      PK: K.orgKey(org),
      SK: K.organizationFiscalCommandSK("TEST", command(1)),
      orgId: org,
      entityType: "PLATFORM_FISCAL_COMMAND",
      actorId: sub,
      intentDigest: hash(JSON.stringify(["STORE_CREDENTIAL", storageRequest])),
      state: undefined,
      status: "COMMITTED",
      result: structuredClone(data),
      createdAt: data.updatedAt,
    },
  );
  const historyKey = {
    PK: K.orgKey(org),
    SK: K.organizationFiscalHistorySK("TEST", connectionId, 1),
  };
  rows.set(key(historyKey), {
    ...historyKey,
    orgId: org,
    entityType: "PLATFORM_FISCAL_HISTORY",
    action: "STORE_CREDENTIAL",
    commandId: command(1),
    data: structuredClone(data),
    secretReference: reference,
  });
  db.on(GetItemCommand).callsFake((input) => {
    const item = rows.get(key(unmarshall(input.Key)));
    return item
      ? { Item: marshall(item, { removeUndefinedValues: true }) }
      : {};
  });
  db.on(QueryCommand).callsFake(() => ({
    Items: [
      marshall(rows.get(key(connectionKey))!, { removeUndefinedValues: true }),
    ],
  }));
  db.on(TransactWriteItemsCommand).callsFake(apply);
  ssm.on(GetParameterCommand).resolves({
    Parameter: {
      Name: reference,
      Type: "SecureString",
      Version: 1,
      Value: token,
    },
  });
  jest
    .spyOn(OrganizationLegalIdentityService, "readFiscalTaxpayerAuthority")
    .mockImplementation(async () => {
      const version = Number(rows.get(key(identityKey))?.version);
      return {
        ifu: data.taxpayerIfu,
        binding: {
          reference: "47f21561-49ad-4570-909b-0f3613f0569b",
          version: String(version),
          digest: "a".repeat(64),
          selectionVersion: version,
        },
        check: {
          ConditionCheck: {
            TableName: "test",
            Key: marshall(identityKey),
            ConditionExpression: "#version = :identityVersion",
            ExpressionAttributeNames: { "#version": "version" },
            ExpressionAttributeValues: marshall({
              ":identityVersion": version,
            }),
          },
        },
      };
    });
});
afterEach(() => {
  expect(fetch).not.toHaveBeenCalled();
  jest.restoreAllMocks();
  jest.useRealTimers();
});
test("successful version-bound verification pins the secret version and records sanitized immutable audit", async () => {
  const result = await service().verify(org, principal, request());
  expect(result.status).toBe("VERIFIED_TEST");
  expect(result.checks.issuanceEligible).toBe(false);
  expect(ssm.commandCalls(GetParameterCommand)[0].args[0].input).toEqual({
    Name: reference + ":1",
    WithDecryption: true,
  });
  expect(transport).toHaveBeenCalledTimes(1);
  const audits = [...rows.values()].filter(
    (row) => row.entityType === "PLATFORM_FISCAL_VERIFICATION_AUDIT",
  );
  expect(audits).toHaveLength(1);
  expect(audits[0]).toMatchObject({
    binding: {
      configurationVersion: 1,
      credentialVersion: 1,
      credentialReference: reference,
      credentialStorageVersion: 1,
      identity: { selectionVersion: 1 },
    },
  });
  expect(JSON.stringify([...rows.values()])).not.toContain(token);
  expect(JSON.stringify(result)).not.toContain(reference);
  const view = await OrganizationFiscalRepository.list(org, sub, {
    environment: "TEST",
  });
  expect(view.connections[0].verification?.lastVerified?.status).toBe(
    "VERIFIED_TEST",
  );
  expect(JSON.stringify(view)).not.toContain(reference);
});
test("consumes a credential deposited through actual B2 create/store, including supported uppercase command UUIDs", async () => {
  rows.delete(key(connectionKey));
  for (const [rowKey, row] of rows) {
    if (
      row.entityType === "PLATFORM_FISCAL_COMMAND" ||
      row.entityType === "PLATFORM_FISCAL_HISTORY"
    )
      rows.delete(rowKey);
  }
  db.on(PutItemCommand).callsFake((input) => {
    const item = unmarshall(input.Item!);
    if (rows.has(key(item))) cancelled();
    rows.set(key(item), item);
    return {};
  });
  ssm.on(PutParameterCommand).resolves({ Version: 1 });
  await OrganizationFiscalRepository.change(org, principal, "CONFIGURE", {
    environment: "TEST",
    connectionId,
    label: "Actual B2 workflow",
    taxpayerIfu: data.taxpayerIfu,
    nim: data.nim,
    expectedVersion: 0,
    commandId: command(50),
  });
  const storageId = "ABCDEFAB-ABCD-4BCD-8BCD-ABCDEFABCDEF";
  await OrganizationFiscalRepository.change(
    org,
    principal,
    "STORE_CREDENTIAL",
    {
      environment: "TEST",
      connectionId,
      expectedVersion: 1,
      commandId: storageId,
      token,
    },
  );
  const storedReference = `/${principal.stage}/platform/fiscal/${hash(org)}/TEST/${storageId}`;
  ssm.on(GetParameterCommand).resolves({
    Parameter: {
      Name: storedReference,
      Type: "SecureString",
      Version: 1,
      Value: token,
    },
  });
  expect(
    (
      await service().verify(org, principal, {
        ...request(52),
        expectedVersion: 2,
      })
    ).status,
  ).toBe("VERIFIED_TEST");
  expect(ssm.commandCalls(GetParameterCommand).at(-1)!.args[0].input.Name).toBe(
    storedReference + ":1",
  );
});
test.each(["disabled", "PRODUCTION", "prod-stage"])(
  "%s gate never reads credentials or dispatches provider traffic",
  async (variant) => {
    const req = request();
    const actor = { ...principal };
    if (variant === "disabled")
      process.env.FISCAL_CREDENTIAL_TEST_VERIFICATION_ENABLED = "0";
    if (variant === "prod-stage") actor.stage = "prod" as "dev";
    if (variant === "PRODUCTION") {
      req.environment = "PRODUCTION";
      const row = structuredClone(rows.get(key(connectionKey))!);
      row.SK = K.organizationFiscalConnectionSK("PRODUCTION", connectionId);
      (row.data as typeof data).environment = "PRODUCTION";
      rows.set(key(row), row);
    }
    const result = await service().verify(org, actor, req);
    expect(result.status).toBe("VERIFICATION_NOT_ENABLED");
    expect(ssm.commandCalls(GetParameterCommand)).toHaveLength(0);
    expect(transport).not.toHaveBeenCalled();
  },
);
test.each([
  { role: "MEMBER" },
  { accessSource: "CABINET" },
  { workspaceType: "ACCOUNTING_FIRM" },
  { status: "DISABLED" },
])(
  "OWNER authorization required before secret access %j",
  async (overrides) => {
    Object.assign(rows.get(key(membershipKey))!, overrides);
    await expect(
      service().verify(org, principal, request()),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(ssm.commandCalls(GetParameterCommand)).toHaveLength(0);
    expect(transport).not.toHaveBeenCalled();
  },
);
test("known foreign connection identifier does not bypass tenant authorization", async () => {
  await expect(
    service().verify("foreign-org", principal, request()),
  ).rejects.toMatchObject({ statusCode: 403 });
  expect(transport).not.toHaveBeenCalled();
});
test("an authorized owner cannot use a connection UUID from another organization", async () => {
  const row = rows.get(key(connectionKey))!;
  rows.delete(key(connectionKey));
  rows.set(key({ ...connectionKey, PK: K.orgKey("org-b") }), {
    ...row,
    PK: K.orgKey("org-b"),
    orgId: "org-b",
  });
  await expect(
    service().verify(org, principal, request()),
  ).rejects.toMatchObject({ statusCode: 404 });
  expect(ssm.commandCalls(GetParameterCommand)).toHaveLength(0);
  expect(transport).not.toHaveBeenCalled();
});
test.each([
  [401, {}, "AUTHENTICATION_REJECTED"],
  [200, { ...evidence, tokenValid: "invalid" }, "PROVIDER_RESPONSE_INVALID"],
  [
    200,
    { ...evidence, tokenValid: "2026-11-06T12:00:00Z" },
    "CREDENTIAL_EXPIRED",
  ],
  [200, { ...evidence, ifu: "other" }, "IFU_MISMATCH"],
])(
  "provider outcome is sanitized and durably typed: %s %j",
  async (status, body, outcome) => {
    transport.mockResolvedValueOnce({
      status: Number(status),
      body: JSON.stringify(body),
    });
    const result = await service().verify(org, principal, request());
    expect(result.status).toBe(outcome);
    expect(result.checks.issuanceEligible).toBe(false);
    expect(JSON.stringify(result)).not.toContain(token);
  },
);
test.each([
  "reference-org",
  "reference-environment",
  "history-connection",
  "parameter-version",
  "parameter-bytes",
  "oversized",
])("rejects broken credential binding: %s", async (variant) => {
  if (variant.startsWith("reference"))
    rows.get(key(connectionKey))!.secretReference =
      variant === "reference-org"
        ? reference.replace(hash(org), hash("other"))
        : reference.replace("/TEST/", "/PRODUCTION/");
  if (variant === "history-connection")
    rows.get(
      key({
        PK: K.orgKey(org),
        SK: K.organizationFiscalHistorySK("TEST", connectionId, 1),
      }),
    )!.commandId = command(99);
  if (variant === "parameter-version")
    ssm.on(GetParameterCommand).resolves({
      Parameter: { Type: "SecureString", Version: 2, Value: token },
    });
  if (variant === "parameter-bytes")
    ssm.on(GetParameterCommand).resolves({
      Parameter: { Type: "SecureString", Version: 1, Value: "a.b.different" },
    });
  if (variant === "oversized")
    ssm.on(GetParameterCommand).resolves({
      Parameter: {
        Type: "SecureString",
        Version: 1,
        Value: "a".repeat(4096) + ".b.c",
      },
    });
  expect((await service().verify(org, principal, request())).status).toBe(
    "CREDENTIAL_CONFIGURATION_INVALID",
  );
  expect(transport).not.toHaveBeenCalled();
});
test("missing reviewed taxpayer identity remains incomplete without a status probe", async () => {
  jest
    .mocked(OrganizationLegalIdentityService.readFiscalTaxpayerAuthority)
    .mockRejectedValue(new Error("missing authority"));
  expect((await service().verify(org, principal, request())).status).toBe(
    "VERIFICATION_INCOMPLETE",
  );
  expect(transport).not.toHaveBeenCalled();
});
test.each([
  "credential",
  "suspension",
  "configuration",
  "identity",
  "membership",
])(
  "in-flight %s change cannot publish a current successful verification",
  async (variant) => {
    transport.mockImplementationOnce(async () => {
      const row = rows.get(key(connectionKey))!,
        details = row.data as typeof data;
      if (variant === "identity") rows.get(key(identityKey))!.version = 2;
      else if (variant === "membership")
        rows.get(key(membershipKey))!.role = "MEMBER";
      else {
        details.version = 2;
        if (variant === "credential")
          row.secretReference = reference.replace(command(1), command(90));
        if (variant === "suspension") {
          details.credentialStatus = "REVOKED";
          delete row.secretReference;
        }
      }
      return { status: 200, body: JSON.stringify(evidence) };
    });
    if (variant === "membership")
      await expect(
        service().verify(org, principal, request()),
      ).rejects.toMatchObject({ statusCode: 403 });
    else
      expect((await service().verify(org, principal, request())).status).toBe(
        "STALE_CONFIGURATION",
      );
    const stored = [...rows.values()].find(
      (row) => row.entityType === "PLATFORM_FISCAL_VERIFICATION_AUDIT",
    )!;
    expect(stored).toMatchObject({
      result: { status: "STALE_CONFIGURATION", applicable: false },
    });
  },
);
test("duplicate command is a read; expired or obsolete evidence cannot become current", async () => {
  await service().verify(org, principal, request());
  await service().verify(org, principal, request());
  expect(transport).toHaveBeenCalledTimes(1);
  now = "2026-11-09T12:00:00.000Z";
  expect((await service().verify(org, principal, request())).status).toBe(
    "CREDENTIAL_EXPIRED",
  );
  rows.get(key(identityKey))!.version = 2;
  expect((await service().verify(org, principal, request())).status).toBe(
    "STALE_CONFIGURATION",
  );
});
test("latest transient failure retains previous verified evidence separately", async () => {
  await service().verify(org, principal, request());
  transport.mockRejectedValueOnce(
    new Error("private provider detail " + token),
  );
  expect((await service().verify(org, principal, request(3))).status).toBe(
    "PROVIDER_UNAVAILABLE",
  );
  const view = await OrganizationFiscalRepository.list(org, sub, {
    environment: "TEST",
  });
  expect(view.connections[0].verification).toMatchObject({
    latestAttempt: { status: "PROVIDER_UNAVAILABLE" },
    lastVerified: { status: "VERIFIED_TEST" },
  });
  expect(JSON.stringify(view)).not.toContain(token);
});
test("concurrent attempts serialize; duplicate in-flight command does not dispatch twice", async () => {
  let resolve!: (value: { status: number; body: string }) => void;
  transport.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const active = service().verify(org, principal, request());
  for (let wait = 0; wait < 50 && !resolve; wait++)
    await new Promise((done) => setTimeout(done, 0));
  expect(resolve).toBeDefined();
  const duplicate = await service().verify(org, principal, request());
  expect(duplicate.inProgress).toBe(true);
  await expect(
    service().verify(org, principal, request(3)),
  ).rejects.toMatchObject({ messageCode: "PLATFORM_FISCAL_VERIFICATION_BUSY" });
  resolve({ status: 200, body: JSON.stringify(evidence) });
  await active;
  expect(transport).toHaveBeenCalledTimes(1);
});
test("lost final transaction response resolves the same durable result", async () => {
  let transactions = 0;
  db.on(TransactWriteItemsCommand).callsFake((input) => {
    const response = apply(input);
    if (++transactions === 2) throw new Error("lost response");
    return response;
  });
  expect((await service().verify(org, principal, request())).status).toBe(
    "VERIFIED_TEST",
  );
  expect(transport).toHaveBeenCalledTimes(1);
});
test("expired lease permits an explicit new attempt; a delayed old response remains historical", async () => {
  let resolve!: (value: { status: number; body: string }) => void;
  transport.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const first = service().verify(org, principal, request());
  for (let wait = 0; wait < 50 && !resolve; wait++)
    await new Promise((done) => setTimeout(done, 0));
  expect(resolve).toBeDefined();
  now = "2026-11-07T12:01:00.000Z";
  const expired = await service().verify(org, principal, request());
  expect(expired.inProgress).toBe(false);
  expect((await service().verify(org, principal, request(3))).status).toBe(
    "VERIFIED_TEST",
  );
  resolve({ status: 200, body: JSON.stringify(evidence) });
  expect((await first).status).toBe("STALE_CONFIGURATION");
  expect(transport).toHaveBeenCalledTimes(2);
  const current = await OrganizationFiscalRepository.list(org, sub, {
    environment: "TEST",
  });
  expect(current.connections[0].verification?.latestAttempt.operationId).toBe(
    command(3),
  );
});
test("JWT API strips no tenant forgery into the command and never accepts arbitrary endpoint fields", async () => {
  const event = {
    routeKey:
      "POST /me/organization/fiscality/connections/{connectionId}/verification",
    headers: { "x-org-id": org },
    pathParameters: { connectionId },
    body: JSON.stringify({
      environment: "TEST",
      expectedVersion: 1,
      commandId: command(2),
      baseUrl: "https://attacker.example",
      orgId: "other",
    }),
    requestContext: { authorizer: { jwt: { claims: { iss: issuer, sub } } } },
  } as unknown as Event;
  expect((await handler(event)).statusCode).toBe(400);
  delete (event.requestContext.authorizer.jwt.claims as Record<string, unknown>)
    .sub;
  expect((await handler(event)).statusCode).toBe(401);
  expect(transport).not.toHaveBeenCalled();
});
