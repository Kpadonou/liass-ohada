import {
  BatchGetItemCommand,
  DynamoDBClient,
  GetItemCommand,
  QueryCommand,
  ScanCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { mockClient } from "aws-sdk-client-mock";
import { handler } from "@/lambda/domains/identity/list-organization-members";
import { config } from "@/lambda/shared/config";
import { KeyFactory as K } from "@/lambda/shared/key-builder";
import {
  ListOrganizationMembersRequestSchema,
  ListOrganizationMembersResponseSchema,
  OrganizationMemberSummarySchema,
} from "@liass-ohada/shared/shared";

const db = mockClient(DynamoDBClient);
const table = config.PLATFORM_TABLE_NAME;
const orgId = "org-company";
const actor = "platform-owner";
const now = "2026-10-15T10:00:00.000Z";
const member = (userId: string, overrides: Record<string, unknown> = {}) => ({
  PK: K.orgKey(orgId),
  SK: K.orgUserAccessSK(userId),
  entityType: "USER_ORG_ACCESS",
  orgId,
  userId,
  workspaceType: "COMPANY",
  accessSource: "DIRECT",
  status: "ACTIVE",
  role: "MEMBER",
  ...overrides,
});
const organization = (overrides: Record<string, unknown> = {}) => ({
  PK: K.orgKey(orgId),
  SK: K.organizationSK(),
  entityType: "ORGANIZATION",
  orgId,
  workspaceType: "COMPANY",
  status: "ACTIVE",
  ...overrides,
});
const profile = (userId: string, overrides: Record<string, unknown> = {}) => ({
  PK: K.userProfilePK(userId),
  SK: K.userProfileSK(),
  entityType: "USER_PROFILE",
  userId,
  displayName: `Name ${userId}`,
  email: `${userId}@example.test`,
  normalizedEmail: `${userId}@example.test`,
  emailVerified: true,
  createdAt: now,
  updatedAt: now,
  lastSyncedFromIdentityAt: now,
  providerUsername: "do-not-expose",
  oauth: "secret",
  ...overrides,
});
const event = (
  query: Record<string, unknown> = {},
  userId = actor,
  tenant = orgId,
) => ({
  headers: { "x-org-id": tenant, "accept-language": "en" },
  requestContext: { authorizer: { jwt: { claims: { sub: userId } } } },
  queryStringParameters: query,
});
const parse = (response: { body: string }) => JSON.parse(response.body);

function authorization(
  access: Record<string, unknown> = member(actor, { role: "OWNER" }),
  org = organization(),
) {
  db.on(GetItemCommand).callsFake((input) => {
    const key = unmarshall(input.Key);
    if (key.PK === K.orgKey(orgId) && key.SK === K.orgUserAccessSK(actor))
      return { Item: marshall(access) };
    if (key.PK === K.orgKey(orgId) && key.SK === K.organizationSK())
      return { Item: marshall(org) };
    return {};
  });
}
beforeEach(() => {
  db.reset();
  authorization();
  db.on(QueryCommand).resolves({ Items: [] });
  db.on(BatchGetItemCommand).callsFake((input) => ({
    Responses: {
      [table]: input.RequestItems[table].Keys.map(
        (key: Record<string, { S: string }>) =>
          marshall(profile(key.PK.S.slice(5))),
      ),
    },
  }));
});
afterAll(() => db.restore());

test("organization OWNER reads direct members with canonical safe profiles and explicit lifecycle, without product access", async () => {
  db.on(QueryCommand).resolves({
    Items: [
      member("a"),
      member("b", { status: "SUSPENDED" }),
      member("c", { status: "REVOKED" }),
    ].map((row) =>
      marshall({
        ...row,
        displayName: "Organization name is not a person",
        productRoles: { RESTAURANTS: "OWNER" },
      }),
    ),
  });
  const response = await handler(event());
  expect(response.statusCode).toBe(200);
  const body = ListOrganizationMembersResponseSchema.parse(parse(response));
  expect(body.items).toEqual(
    ["ACTIVE", "SUSPENDED", "REVOKED"].map((status, index) => ({
      userId: ["a", "b", "c"][index],
      status,
      displayName: `Name ${["a", "b", "c"][index]}`,
      email: `${["a", "b", "c"][index]}@example.test`,
    })),
  );
  expect(Object.keys(body.items[0]).sort()).toEqual([
    "displayName",
    "email",
    "status",
    "userId",
  ]);
  const query = db.commandCalls(QueryCommand)[0].args[0].input;
  expect(query).toMatchObject({
    TableName: table,
    KeyConditionExpression: "PK = :pk AND begins_with(SK, :prefix)",
    Limit: 50,
    ScanIndexForward: true,
    ConsistentRead: true,
  });
  expect(unmarshall(query.ExpressionAttributeValues!)).toEqual({
    ":pk": K.orgKey(orgId),
    ":prefix": K.orgUserAccessPrefix(),
  });
  expect(query.FilterExpression).toBeUndefined();
  expect(query.IndexName).toBeUndefined();
  expect(db.commandCalls(ScanCommand)).toHaveLength(0);
  expect(db.commandCalls(BatchGetItemCommand)).toHaveLength(1);
});

test.each(["MEMBER", "MANAGER", "WAITER", "CASHIER", "KITCHEN", "ADMIN"])(
  "non-owner %s cannot discover members even with restaurant OWNER",
  async (role) => {
    authorization(
      member(actor, { role, productRoles: { RESTAURANTS: "OWNER" } }),
    );
    expect((await handler(event())).statusCode).toBe(403);
    expect(db.commandCalls(QueryCommand)).toHaveLength(0);
  },
);

test.each([
  { status: "SUSPENDED" },
  { status: "REVOKED" },
  { workspaceType: "ACCOUNTING_FIRM" },
  { accessSource: "CABINET" },
  { orgId: "foreign" },
  { userId: "foreign" },
  { entityType: "OTHER" },
])(
  "invalid/inactive/foreign caller membership denied: %j",
  async (overrides) => {
    authorization(member(actor, { role: "OWNER", ...overrides }));
    expect((await handler(event())).statusCode).toBe(403);
    expect(db.commandCalls(QueryCommand)).toHaveLength(0);
  },
);

test.each([
  { status: "INACTIVE" },
  { workspaceType: "ACCOUNTING_FIRM" },
  { orgId: "foreign" },
  { entityType: "OTHER" },
])("inactive or non-COMPANY organization denied: %j", async (overrides) => {
  authorization(member(actor, { role: "OWNER" }), organization(overrides));
  expect((await handler(event())).statusCode).toBe(403);
  expect(db.commandCalls(QueryCommand)).toHaveLength(0);
});

test("missing identity, tenant, membership and foreign tenant fail closed", async () => {
  expect((await handler(event({}, ""))).statusCode).toBe(401);
  expect((await handler(event({}, actor, ""))).statusCode).toBe(400);
  expect((await handler(event({}, actor, "foreign"))).statusCode).toBe(403);
  expect((await handler(event({}, "stranger"))).statusCode).toBe(403);
  expect(db.commandCalls(QueryCommand)).toHaveLength(0);
});

test("forged org/user parameters never replace verified context; arbitrary roles and fields rejected", async () => {
  const response = await handler(
    event({ orgId: "foreign", userId: "foreign" }),
  );
  expect(response.statusCode).toBe(200); // Canonical wrapper strips these fields.
  expect(
    unmarshall(
      db.commandCalls(QueryCommand)[0].args[0].input.ExpressionAttributeValues!,
    )[":pk"],
  ).toBe(K.orgKey(orgId));
  expect((await handler(event({ role: "OWNER" }))).statusCode).toBe(400);
  expect((await handler(event({ search: "name" }))).statusCode).toBe(400);
});

test("pagination returns canonical order and resumes with a server-built key", async () => {
  db.on(QueryCommand)
    .resolvesOnce({
      Items: [marshall(member("a")), marshall(member("b"))],
      LastEvaluatedKey: marshall({
        PK: K.orgKey(orgId),
        SK: K.orgUserAccessSK("b"),
      }),
    })
    .resolves({ Items: [marshall(member("c"))] });
  const first = parse(await handler(event({ limit: "2" })));
  expect(first.items.map((row: { userId: string }) => row.userId)).toEqual([
    "a",
    "b",
  ]);
  expect(first.nextCursor).toBeTruthy();
  const second = parse(
    await handler(event({ limit: "2", cursor: first.nextCursor })),
  );
  expect(second.items.map((row: { userId: string }) => row.userId)).toEqual([
    "c",
  ]);
  expect(second.nextCursor).toBeUndefined();
  expect(
    unmarshall(
      db.commandCalls(QueryCommand)[1].args[0].input.ExclusiveStartKey!,
    ),
  ).toEqual({ PK: K.orgKey(orgId), SK: K.orgUserAccessSK("b") });
});

test("cursor cannot replay in another organization, caller or query shape", async () => {
  db.on(QueryCommand).resolves({
    Items: [],
    LastEvaluatedKey: marshall({
      PK: K.orgKey(orgId),
      SK: K.orgUserAccessSK("a"),
    }),
  });
  const cursor = parse(await handler(event({ limit: "2" }))).nextCursor;
  db.resetHistory();
  expect((await handler(event({ limit: "3", cursor }))).statusCode).toBe(400);
  db.on(GetItemCommand).callsFake((input) => {
    const key = unmarshall(input.Key);
    const tenant = key.PK.slice(4);
    return {
      Item: marshall(
        key.SK === K.organizationSK()
          ? organization({ ...key, orgId: tenant })
          : member(key.SK.slice(5), { ...key, orgId: tenant, role: "OWNER" }),
      ),
    };
  });
  expect(
    (await handler(event({ limit: "2", cursor }, "other-owner"))).statusCode,
  ).toBe(400);
  expect(
    (await handler(event({ limit: "2", cursor }, actor, "other-org")))
      .statusCode,
  ).toBe(400);
  expect(db.commandCalls(QueryCommand)).toHaveLength(0);
});

test.each([
  "garbage",
  Buffer.from("{}").toString("base64url"),
  Buffer.from(JSON.stringify({ PK: "foreign", SK: "USER#a" })).toString(
    "base64url",
  ),
  "bad+padding=",
])("malformed cursor rejected: %s", async (cursor) => {
  expect((await handler(event({ cursor }))).statusCode).toBe(400);
  expect(db.commandCalls(QueryCommand)).toHaveLength(0);
});

test.each(["0", "101", "-1", "1.5", "1e2", "", " 2", "0x10", true, 2.5, null])(
  "strict request rejects invalid limit %j",
  async (limit) => {
    expect(
      ListOrganizationMembersRequestSchema.safeParse({ limit }).success,
    ).toBe(false);
    expect((await handler(event({ limit }))).statusCode).toBe(400);
  },
);

test("directory excludes Cabinet-derived and non-COMPANY rows but retains physical page cursor", async () => {
  db.on(QueryCommand).resolves({
    Items: [
      marshall(member("a", { accessSource: "CABINET" })),
      marshall(member("b", { workspaceType: "ACCOUNTING_FIRM" })),
    ],
    LastEvaluatedKey: marshall({
      PK: K.orgKey(orgId),
      SK: K.orgUserAccessSK("b"),
    }),
  });
  const response = parse(await handler(event()));
  expect(response.items).toEqual([]);
  expect(response.nextCursor).toBeTruthy();
  expect(db.commandCalls(BatchGetItemCommand)).toHaveLength(0);
});

test("missing profile and email fallback have no fabricated person name", async () => {
  db.on(QueryCommand).resolves({
    Items: ["a", "b", "c", "d"].map((user) => marshall(member(user))),
  });
  db.on(BatchGetItemCommand).resolves({
    Responses: {
      [table]: [
        marshall(profile("b", { displayName: "b@example.test" })),
        marshall(profile("c", { displayName: "c" })),
        marshall(
          profile("d", { displayName: "Someone", emailVerified: false }),
        ),
      ],
    },
  });
  const body = parse(await handler(event()));
  expect(body.items).toEqual([
    { userId: "a", status: "ACTIVE" },
    { userId: "b", status: "ACTIVE", email: "b@example.test" },
    { userId: "c", status: "ACTIVE", email: "c@example.test" },
    { userId: "d", status: "ACTIVE" },
  ]);
});

test("maximum page hydrates in one bounded BatchGet, not N+1", async () => {
  db.on(QueryCommand).resolves({
    Items: Array.from({ length: 100 }, (_, index) =>
      marshall(member(`person-${index}`)),
    ),
  });
  expect(parse(await handler(event({ limit: "100" }))).items).toHaveLength(100);
  expect(db.commandCalls(QueryCommand)).toHaveLength(1);
  expect(db.commandCalls(GetItemCommand)).toHaveLength(3); // wrapper membership, service authority, organization
  expect(db.commandCalls(BatchGetItemCommand)).toHaveLength(1);
  expect(
    db.commandCalls(BatchGetItemCommand)[0].args[0].input.RequestItems![table],
  ).toMatchObject({ ConsistentRead: true });
});

test("unprocessed profiles use bounded retry and fail rather than silently return incomplete hydration", async () => {
  db.on(QueryCommand).resolves({ Items: [marshall(member("a"))] });
  db.on(BatchGetItemCommand).callsFake((input) => ({
    UnprocessedKeys: input.RequestItems,
  }));
  expect((await handler(event())).statusCode).toBe(503);
  expect(db.commandCalls(BatchGetItemCommand)).toHaveLength(3);
});

test("empty collection requires no hydration", async () => {
  expect(parse(await handler(event()))).toEqual({ items: [] });
  expect(db.commandCalls(BatchGetItemCommand)).toHaveLength(0);
});

test.each([
  { orgId: "foreign" },
  { SK: "USER#different" },
  { entityType: "OTHER" },
])("foreign or corrupt query rows fail closed %j", async (overrides) => {
  db.on(QueryCommand).resolves({ Items: [marshall(member("a", overrides))] });
  expect((await handler(event())).statusCode).toBe(500);
  expect(db.commandCalls(BatchGetItemCommand)).toHaveLength(0);
});

test("strict public contracts never accept product, provider or persistence fields", () => {
  const valid = { userId: "member", status: "ACTIVE" };
  expect(OrganizationMemberSummarySchema.parse(valid)).toEqual(valid);
  for (const field of [
    "PK",
    "SK",
    "GSI6PK",
    "sub",
    "providerUsername",
    "productRoles",
    "password",
    "orgId",
  ])
    expect(
      OrganizationMemberSummarySchema.safeParse({ ...valid, [field]: "hidden" })
        .success,
    ).toBe(false);
  expect(
    ListOrganizationMembersResponseSchema.safeParse({
      items: [valid],
      total: 1,
    }).success,
  ).toBe(false);
});
