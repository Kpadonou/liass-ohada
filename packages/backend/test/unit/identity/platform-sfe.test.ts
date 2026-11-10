import {
  DynamoDBClient,
  GetItemCommand,
  TransactWriteItemsCommand,
} from "@aws-sdk/client-dynamodb";
import { mockClient } from "aws-sdk-client-mock";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { handler } from "@/lambda/domains/identity/platform-sfe-handler";
import { PlatformSfeRepository as Repository } from "@/lambda/shared/repositories/platform-sfe-repository";
import { KeyFactory as K } from "@/lambda/shared/key-builder";
import {
  CognitoSubjectSchema,
  platformPrincipalDigest,
} from "@/lambda/shared/authorization/platform-admin";
import { platformAdminGrantPlan } from "../../../scripts/platform-admin-grant-plan";
import type { APIGatewayProxyEventV2WithJWTAuthorizer as Event } from "aws-lambda";

const db = mockClient(DynamoDBClient);
const issuer = "https://cognito-idp.eu-west-3.amazonaws.com/eu-west-3_verified";
const sub = "9e7e0aee-a0bf-45c5-a698-ea7f4f01bfa8";
const principal = { stage: "dev" as const, issuer, sub };
test.each([
  "5169301e-90d1-7056-98ef-1b281095f036",
  "2189c04e-00f1-702c-d8e5-c38569e8974e",
])("accepts Cognito-issued subject %s", (value) => {
  expect(CognitoSubjectSchema.parse(value)).toBe(value);
});
test.each(["", "not-a-cognito-sub", "2189c04e-00f1-702c-d8e5-c38569e8974"])(
  "rejects malformed Cognito subject %j",
  (value) => expect(CognitoSubjectSchema.safeParse(value).success).toBe(false),
);
const fields = {
  approvalLetterReference: "UNIT-TEST-ONLY",
  softwareName: "Synthetic test software",
  softwareVersion: "test",
  countryOfOrigin: "Benin",
  publisher: {
    name: "Test publisher",
    email: "publisher@example.test",
    phone: "test",
  },
  supplier: {
    name: "Test supplier",
    email: "supplier@example.test",
    phone: "test",
  },
};
const request = {
  ...fields,
  expectedVersion: 0,
  commandId: "e78fdc93-8473-4a5b-9da2-11d15f0be585",
};
const grant = () => ({
  PK: K.platformAdminPK("dev", platformPrincipalDigest(principal)),
  SK: K.platformAdminGrantSK(),
  entityType: "PLATFORM_ADMIN_GRANT",
  data: {
    ...principal,
    permission: "PLATFORM_SFE_APPROVAL_MANAGE",
    status: "ACTIVE",
    revokedAt: null as string | null,
    version: 1,
    updatedAt: "2026-11-07T12:00:00.000Z",
    changedByIamArn: "arn:aws:iam::123456789012:role/ApprovedBootstrap",
  },
});
const event = (
  routeKey = "PUT /platform/fiscality/sfe-approval",
  body: unknown = request,
  claims: Record<string, unknown> = { sub, iss: issuer },
) =>
  ({
    routeKey,
    headers: { "x-org-id": "company-a" },
    body: JSON.stringify(body),
    requestContext: { authorizer: { jwt: { claims } } },
  }) as unknown as Event;
beforeEach(() => {
  process.env.STAGE = "dev";
  process.env.PLATFORM_COGNITO_ISSUER = issuer;
  db.reset();
  db.on(GetItemCommand).callsFake((input) => {
    const key = unmarshall(input.Key);
    if (key.SK === K.platformAdminGrantSK()) return { Item: marshall(grant()) };
    if (key.SK === K.orgUserAccessSK(sub))
      return {
        Item: marshall({
          ...key,
          entityType: "USER_ORG_ACCESS",
          orgId: "company-a",
          userId: sub,
          status: "ACTIVE",
          role: "MEMBER",
          workspaceType: "COMPANY",
          country: "BJ",
          accessSource: "DIRECT",
        }),
      };
    return {};
  });
  db.on(TransactWriteItemsCommand).resolves({});
});
test("verified issuer/sub with ACTIVE grant atomically writes current, immutable revision and durable command", async () => {
  expect((await handler(event())).statusCode).toBe(200);
  const reads = db
    .commandCalls(GetItemCommand)
    .map((call) => call.args[0].input);
  expect(reads.every((read) => read.ConsistentRead === true)).toBe(true);
  const tx = db.commandCalls(TransactWriteItemsCommand)[0].args[0].input
    .TransactItems!;
  expect(tx).toHaveLength(4);
  expect(
    unmarshall(tx[0].ConditionCheck!.ExpressionAttributeValues!)[":grant"],
  ).toEqual(grant().data);
  expect(tx[0].ConditionCheck!.ConditionExpression).toContain("entityType");
  expect(tx[1].Put!.ConditionExpression).toBe("attribute_not_exists(PK)");
  expect(
    tx
      .slice(2)
      .every(
        (item) => item.Put!.ConditionExpression === "attribute_not_exists(PK)",
      ),
  ).toBe(true);
  expect(unmarshall(tx[1].Put!.Item!).data.countryOfOrigin).toBe("Benin");
});
test("legacy approval records without country of origin remain readable", async () => {
  const legacyFields = { ...fields, countryOfOrigin: undefined };
  db.on(GetItemCommand).callsFake((input) => {
    const key = unmarshall(input.Key);
    if (key.SK === K.orgUserAccessSK(sub))
      return {
        Item: marshall({
          ...key,
          entityType: "USER_ORG_ACCESS",
          orgId: "company-a",
          userId: sub,
          status: "ACTIVE",
          role: "MEMBER",
          workspaceType: "COMPANY",
          country: "BJ",
          accessSource: "DIRECT",
        }),
      };
    if (key.SK === K.platformSfeCurrentSK())
      return {
        Item: marshall(
          {
            ...key,
            entityType: "PLATFORM_SFE_APPROVAL",
            data: {
              ...legacyFields,
              version: 1,
              updatedAt: "2026-11-07T12:00:00.000Z",
            },
          },
          { removeUndefinedValues: true },
        ),
      };
    return {};
  });
  const result = await handler(
    event("GET /me/organization/fiscality/sfe-approval", {}),
  );
  expect(JSON.parse(result.body).data).toMatchObject({
    status: "REGISTERED",
    approval: { softwareName: fields.softwareName },
  });
  expect(JSON.parse(result.body).data.approval).not.toHaveProperty(
    "countryOfOrigin",
  );
});
test.each([
  "missing",
  "revoked",
  "malformed",
  "wrong-issuer",
  "wrong-sub",
  "wrong-stage",
  "unavailable",
])("%s registry fails closed", async (variant) => {
  db.on(GetItemCommand).callsFake(() => {
    if (variant === "unavailable") throw new Error("private diagnostic");
    if (variant === "missing") return {};
    const row = grant();
    if (variant === "revoked") {
      row.data.status = "REVOKED";
      row.data.revokedAt = "2026-11-07T12:00:00.000Z";
    }
    if (variant === "malformed") row.data.version = 0;
    if (variant === "wrong-issuer") row.data.issuer += "foreign";
    if (variant === "wrong-sub")
      row.data.sub = "7c834867-209b-418a-ad6a-8ec09c70b088";
    if (variant === "wrong-stage") row.data.stage = "prod" as "dev";
    return { Item: marshall(row) };
  });
  const result = await handler(event());
  expect(result.statusCode).toBe(403);
  expect(result.body).not.toContain("private diagnostic");
  expect(db.commandCalls(TransactWriteItemsCommand)).toHaveLength(0);
});
test.each([
  { sub },
  { sub, iss: "https://untrusted.example" },
  { iss: issuer, email: "admin@example.test", "cognito:groups": "ADMIN" },
])("unverified identity cannot select a grant %j", async (claims) => {
  expect((await handler(event(undefined, request, claims))).statusCode).toBe(
    401,
  );
  expect(db.commandCalls(GetItemCommand)).toHaveLength(0);
});
test("no configured issuer or stage fails closed", async () => {
  delete process.env.STAGE;
  expect((await handler(event())).statusCode).toBe(401);
});
test("customer membership reads truthful absence without SALES or administrator privileges", async () => {
  const result = await handler(
    event("GET /me/organization/fiscality/sfe-approval", {}),
  );
  expect(JSON.parse(result.body)).toEqual({
    data: { status: "UNAVAILABLE", approval: null },
  });
  expect(db.commandCalls(TransactWriteItemsCommand)).toHaveLength(0);
});
test("foreign organization membership cannot read", async () => {
  const request = event("GET /me/organization/fiscality/sfe-approval", {});
  request.headers["x-org-id"] = "company-b";
  expect((await handler(request)).statusCode).toBe(403);
});
test("customer OWNER and Cognito group are no substitute for a Platform grant", async () => {
  db.on(GetItemCommand).resolves({});
  expect(
    (
      await handler(
        event(undefined, request, {
          sub,
          iss: issuer,
          role: "OWNER",
          "cognito:groups": "PLATFORM_ADMIN",
        }),
      )
    ).statusCode,
  ).toBe(403);
});
test("certificate URLs and unknown input fields are refused", async () => {
  expect(
    (
      await handler(
        event(undefined, {
          ...request,
          certificateUrl: "https://example.test/private",
        }),
      )
    ).statusCode,
  ).toBe(400);
});
test("revocation between read and privileged commit denies the write", async () => {
  db.on(TransactWriteItemsCommand).callsFake(() => {
    db.on(GetItemCommand).resolves({});
    throw Object.assign(new Error(), {
      name: "TransactionCanceledException",
      CancellationReasons: [{ Code: "ConditionalCheckFailed" }],
    });
  });
  expect((await handler(event())).statusCode).toBe(403);
});
test("concurrent version conflict does not retry the privileged write", async () => {
  db.on(TransactWriteItemsCommand).rejects(
    Object.assign(new Error(), {
      name: "TransactionCanceledException",
      CancellationReasons: [{ Code: "ConditionalCheckFailed" }],
    }),
  );
  expect((await handler(event())).statusCode).toBe(409);
  expect(db.commandCalls(TransactWriteItemsCommand)).toHaveLength(1);
});
test("lost transaction response resolves the same durable command", async () => {
  db.on(TransactWriteItemsCommand).callsFake((input) => {
    const record = input.TransactItems[3].Put.Item;
    db.on(GetItemCommand).callsFake((read) => {
      const key = unmarshall(read.Key);
      return {
        Item: key.SK === K.platformAdminGrantSK() ? marshall(grant()) : record,
      };
    });
    throw new Error("Timeout");
  });
  expect((await handler(event())).statusCode).toBe(200);
  expect(db.commandCalls(TransactWriteItemsCommand)).toHaveLength(1);
});
test("bootstrap/revocation planner is offline, stage-separated and version conditional", () => {
  const input = {
    ...principal,
    tableName: "test-table",
    expectedVersion: 0,
    action: "GRANT",
    changedByIamArn: grant().data.changedByIamArn,
    changedAt: grant().data.updatedAt,
  };
  const plan = platformAdminGrantPlan(input);
  expect(plan.TransactItems[0].Put.ConditionExpression).toBe(
    "attribute_not_exists(PK)",
  );
  const revoke = platformAdminGrantPlan({
    ...input,
    expectedVersion: 1,
    action: "REVOKE",
  });
  expect(unmarshall(revoke.TransactItems[0].Put.Item).data).toMatchObject({
    status: "REVOKED",
    version: 2,
    revokedAt: input.changedAt,
  });
  expect(revoke.TransactItems[0].Put.ConditionExpression).toContain("#version");
  expect(
    unmarshall(
      platformAdminGrantPlan({ ...input, stage: "prod" }).TransactItems[0].Put
        .Item,
    ).PK,
  ).not.toBe(unmarshall(plan.TransactItems[0].Put.Item).PK);
  expect(db.commandCalls(TransactWriteItemsCommand)).toHaveLength(0);
});
