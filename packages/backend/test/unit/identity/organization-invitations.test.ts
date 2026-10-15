import { randomUUID } from "crypto";
import {
  DynamoDBClient,
  GetItemCommand,
  QueryCommand,
  BatchGetItemCommand,
  ScanCommand,
  TransactWriteItemsCommand,
  TransactionCanceledException,
  type TransactWriteItemsCommandInput,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { mockClient } from "aws-sdk-client-mock";
import { OrganizationInvitationService as S } from "@/lambda/shared/services/organization-invitation-service";
import { OrganizationInvitationRepository as R } from "@/lambda/shared/repositories/organization-invitation-repository";
import { OrganizationMemberService } from "@/lambda/shared/services/organization-member-service";
import { InitialProductRoleService } from "@/lambda/shared/services/initial-product-role-service";
import { handler as createHandler } from "@/lambda/domains/identity/create-organization-invitation";
import { handler as acceptHandler } from "@/lambda/domains/identity/accept-organization-invitation";
import { KeyFactory as K } from "@/lambda/shared/key-builder";
import { config } from "@/lambda/shared/config";
import {
  hashInvitationToken,
  newInvitationToken,
} from "@/lambda/shared/services/invitation-security";
import { invitationValidityMs } from "@/lambda/shared/services/invitation-config";
import {
  CreateOrganizationInvitationRequestSchema,
  CreateOrganizationInvitationResponseSchema,
  AcceptOrganizationInvitationRequestSchema,
  AcceptOrganizationInvitationResponseSchema,
} from "@liass-ohada/shared/shared";

type Row = Record<string, unknown>;
const db = mockClient(DynamoDBClient),
  rows = new Map<string, Row>();
const org = "company-a",
  owner = "owner-a",
  user = "member-a",
  email = "aissa@example.test";
const key = (row: Row) => JSON.stringify([row.PK, row.SK]);
const seed = (PK: string, SK: string, data: Row) =>
  rows.set(key({ PK, SK }), { PK, SK, ...data });
const read = (PK: string, SK: string) => rows.get(key({ PK, SK }));
const member = (id = user, data: Row = {}, orgId = org) =>
  seed(K.orgKey(orgId), K.orgUserAccessSK(id), {
    entityType: "USER_ORG_ACCESS",
    orgId,
    userId: id,
    workspaceType: "COMPANY",
    role: "MEMBER",
    status: "ACTIVE",
    accessSource: "DIRECT",
    ...data,
  });
const request = (data: Row = {}) => ({
  clientRequestId: randomUUID(),
  email,
  ...data,
});
const identity = (data: Row = {}) => ({
  userId: user,
  email,
  emailVerified: true,
  displayName: "Aïssatou S.",
  ...data,
});
const create = (input = request(), actor = owner, tenant = org) =>
  S.create(tenant, actor, input);
const accept = (token: string, data: Row = {}) =>
  S.accept({ token }, identity(data));
let beforeCommit: (() => void) | undefined;
function split(expression: string, separator: string): string[] {
  let depth = 0,
    start = 0;
  const parts: string[] = [];
  for (let i = 0; i < expression.length; i++) {
    if (expression[i] === "(") depth++;
    if (expression[i] === ")") depth--;
    if (!depth && expression.startsWith(separator, i)) {
      parts.push(expression.slice(start, i));
      start = i + separator.length;
    }
  }
  parts.push(expression.slice(start));
  return parts;
}
function path(row: Row, p: string, names: Record<string, string>): unknown {
  return p
    .split(".")
    .reduce<unknown>(
      (v, k) =>
        v && typeof v === "object" ? (v as Row)[names[k] ?? k] : undefined,
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
  if (and.length > 1) return and.every((p) => condition(row, p, names, values));
  if (expression.startsWith("(") && expression.endsWith(")"))
    return condition(row, expression.slice(1, -1), names, values);
  const or = split(expression, " OR ");
  if (or.length > 1) return or.some((p) => condition(row, p, names, values));
  const absent = /^attribute_not_exists\((.+)\)$/.exec(expression);
  if (absent) return path(row, absent[1], names) === undefined;
  const m = /^([\w.#]+) (=|<=|>) (:\w+)$/.exec(expression);
  if (!m) throw Error(`Unsupported condition ${expression}`);
  const left = path(row, m[1], names),
    right = values[m[3]];
  return m[2] === "="
    ? JSON.stringify(left) === JSON.stringify(right)
    : typeof left === "string" &&
        typeof right === "string" &&
        (m[2] === "<=" ? left <= right : left > right);
}
function commit(input: TransactWriteItemsCommandInput) {
  beforeCommit?.();
  beforeCommit = undefined;
  const seen = new Set<string>();
  for (const op of input.TransactItems ?? []) {
    const a = op.Put ?? op.Update ?? op.Delete ?? op.ConditionCheck;
    if (!a) throw Error("Unknown operation");
    expect(a.TableName).toBe(config.PLATFORM_TABLE_NAME);
    const k = key(
      unmarshall(
        op.Put?.Item ??
          op.Update?.Key ??
          op.Delete?.Key ??
          op.ConditionCheck!.Key!,
      ),
    );
    expect(seen.has(k)).toBe(false);
    seen.add(k);
    if (
      a.ConditionExpression &&
      !condition(
        rows.get(k) ?? {},
        a.ConditionExpression,
        a.ExpressionAttributeNames ?? {},
        unmarshall(a.ExpressionAttributeValues ?? {}),
      )
    )
      throw new TransactionCanceledException({
        message: "Conditional conflict",
        $metadata: {},
        CancellationReasons: [{ Code: "ConditionalCheckFailed" }],
      });
  }
  for (const op of input.TransactItems ?? []) {
    if (op.Put) {
      const row = unmarshall(op.Put.Item!);
      rows.set(key(row), row);
    }
    if (op.Delete) rows.delete(key(unmarshall(op.Delete.Key!)));
    if (op.Update) {
      const a = op.Update,
        k = key(unmarshall(a.Key!)),
        row = structuredClone(rows.get(k)!),
        v = unmarshall(a.ExpressionAttributeValues!),
        n = a.ExpressionAttributeNames ?? {};
      for (const part of a.UpdateExpression!.slice(4).split(", ")) {
        const [p, t] = part.split(" = ");
        const ps = p.split(".").map((x) => n[x] ?? x);
        let target = row;
        for (const segment of ps.slice(0, -1)) target = target[segment] as Row;
        target[ps.at(-1)!] = v[t];
      }
      rows.set(k, row);
    }
  }
  return {};
}
const invitations = () =>
  [...rows.values()].filter((r) => r.entityType === "ORGANIZATION_INVITATION");
const audits = () =>
  [...rows.values()].filter(
    (r) => r.entityType === "ORGANIZATION_INVITATION_AUDIT",
  );
const acceptedMember = () => read(K.orgKey(org), K.orgUserAccessSK(user));
function seedProfile(id = user, address = email) {
  const now = new Date().toISOString();
  seed(K.userProfilePK(id), K.userProfileSK(), {
    entityType: "USER_PROFILE",
    userId: id,
    email: address,
    normalizedEmail: address,
    emailVerified: true,
    displayName: "Aïssatou S.",
    createdAt: now,
    updatedAt: now,
    lastSyncedFromIdentityAt: now,
  });
  seed(K.userEmailLookupPK(address), K.userEmailLookupSK(), {
    entityType: "USER_EMAIL_LOOKUP",
    userId: id,
    normalizedEmail: address,
    createdAt: now,
    updatedAt: now,
  });
}
beforeEach(() => {
  db.reset();
  rows.clear();
  beforeCommit = undefined;
  jest.useFakeTimers().setSystemTime(new Date("2026-10-16T10:00:00.000Z"));
  process.env.NODE_ENV = "development";
  process.env.ORGANIZATION_INVITATION_EXPOSE_TOKEN = "true";
  delete process.env.ORGANIZATION_INVITATION_VALIDITY_DAYS;
  seed(K.orgKey(org), K.organizationSK(), {
    entityType: "ORGANIZATION",
    orgId: org,
    workspaceType: "COMPANY",
    status: "ACTIVE",
    name: "Company A",
    country: "BJ",
  });
  member(owner, { role: "OWNER" });
  db.on(GetItemCommand).callsFake((input) => {
    expect(input.ConsistentRead).toBe(true);
    const row = rows.get(key(unmarshall(input.Key)));
    return row ? { Item: marshall(row) } : {};
  });
  db.on(TransactWriteItemsCommand).callsFake(commit);
  db.on(QueryCommand).callsFake((input) => {
    const values = unmarshall(input.ExpressionAttributeValues);
    return {
      Items: [...rows.values()]
        .filter(
          (r) =>
            r.PK === values[":pk"] &&
            String(r.SK).startsWith(String(values[":prefix"])),
        )
        .map((r) => marshall(r)),
    };
  });
  db.on(BatchGetItemCommand).callsFake((input) => ({
    Responses: {
      [config.TABLE_NAME]: input.RequestItems[config.TABLE_NAME].Keys.flatMap(
        (k: Record<string, { S: string }>) => {
          const row = rows.get(key(unmarshall(k)));
          return row ? [marshall(row)] : [];
        },
      ),
    },
  }));
});
afterEach(() => {
  jest.useRealTimers();
  process.env.NODE_ENV = "test";
  delete process.env.ORGANIZATION_INVITATION_EXPOSE_TOKEN;
  delete process.env.ORGANIZATION_INVITATION_VALIDITY_DAYS;
});
afterAll(() => db.restore());

test("OWNER creates a normalized, seven-day invitation with only hashed token persistence and atomic audit", async () => {
  const result = await create(request({ email: "  AISSA@EXAMPLE.TEST  " }));
  expect(result.invitation.email).toBe(email);
  expect(result.invitation.expiresAt).toBe("2026-10-23T10:00:00.000Z");
  expect(result.invitationToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
  const stored = invitations()[0];
  expect(stored.tokenHash).toBe(hashInvitationToken(result.invitationToken!));
  expect(JSON.stringify([...rows.values()])).not.toContain(
    result.invitationToken!,
  );
  expect(audits()).toEqual([
    expect.objectContaining({
      action: "CREATE_ORGANIZATION_INVITATION",
      actorUserId: owner,
      email,
      after: "PENDING",
    }),
  ]);
  expect(db.commandCalls(ScanCommand)).toHaveLength(0);
  expect(db.commandCalls(QueryCommand)).toHaveLength(0);
});
test.each(["MEMBER", "MANAGER", "WAITER", "CASHIER", "KITCHEN"])(
  "product/organization role %s cannot invite",
  async (role) => {
    member(owner, {
      role: "MEMBER",
      productRoles: { RESTAURANTS: role === "MEMBER" ? "OWNER" : role },
    });
    await expect(create()).rejects.toMatchObject({ statusCode: 403 });
    expect(audits()).toHaveLength(0);
  },
);
test.each([
  { status: "REVOKED" },
  { status: "SUSPENDED" },
  { accessSource: "CABINET_LINK" },
  { workspaceType: "ACCOUNTING_FIRM" },
])("invalid actor membership denied: %j", async (data) => {
  member(owner, { role: "OWNER", ...data });
  await expect(create()).rejects.toMatchObject({ statusCode: 403 });
});
test("inactive organization and foreign organization are denied", async () => {
  await expect(create(request(), owner, "foreign")).rejects.toMatchObject({
    statusCode: 403,
  });
  read(K.orgKey(org), K.organizationSK())!.status = "INACTIVE";
  await expect(create()).rejects.toMatchObject({ statusCode: 403 });
});
test.each(["ACTIVE", "SUSPENDED", "REVOKED"])(
  "existing %s member is never invited/reactivated",
  async (status) => {
    seedProfile();
    member(user, { status });
    await expect(create()).rejects.toMatchObject({
      messageCode: "ORGANIZATION_INVITATION_MEMBER_EXISTS",
    });
    expect(invitations()).toHaveLength(0);
  },
);
test("duplicate pending invitation conflicts but exact command replay returns canonical state without persisting/recovering a raw token", async () => {
  const intent = request(),
    first = await create(intent),
    count = rows.size;
  const again = await create(intent);
  expect(again.invitation).toEqual(first.invitation);
  expect(again.invitationToken).toBeUndefined();
  expect(rows.size).toBe(count);
  await expect(create()).rejects.toMatchObject({
    messageCode: "ORGANIZATION_INVITATION_PENDING",
  });
  await expect(
    create({ ...intent, email: "other@example.test" }),
  ).rejects.toMatchObject({
    messageCode: "ORGANIZATION_INVITATION_IDEMPOTENCY_CONFLICT",
  });
  member("owner-b", { role: "OWNER" });
  await expect(create(intent, "owner-b")).rejects.toMatchObject({
    messageCode: "ORGANIZATION_INVITATION_PENDING",
  });
});
test("two concurrent owners produce one pending invitation; same-command race converges", async () => {
  member("owner-b", { role: "OWNER" });
  const outcomes = await Promise.allSettled([
    create(),
    create(request(), "owner-b"),
  ]);
  expect(outcomes.filter((x) => x.status === "fulfilled")).toHaveLength(1);
  expect(invitations()).toHaveLength(1);
});
test("concurrent same request converges to a single durable command/audit", async () => {
  const intent = request();
  const results = await Promise.all([create(intent), create(intent)]);
  expect(results[0].invitation.invitationId).toBe(
    results[1].invitation.invitationId,
  );
  expect(invitations()).toHaveLength(1);
  expect(audits()).toHaveLength(1);
});
test("expired lock is replaced atomically without reviving the old invitation", async () => {
  const old = await create();
  jest.setSystemTime(new Date("2026-10-24T10:00:00.000Z"));
  const next = await create();
  expect(next.invitation.invitationId).not.toBe(old.invitation.invitationId);
  expect(invitations().filter((r) => r.status === "EXPIRED")).toHaveLength(1);
  await expect(accept(old.invitationToken!)).rejects.toMatchObject({
    statusCode: 409,
  });
});
test("matching verified authenticated identity accepts, appears in directory and receives initial role only through MEM-1B", async () => {
  const invite = await create();
  const result = await accept(invite.invitationToken!);
  expect(result).toEqual({ organizationId: org, membershipStatus: "ACTIVE" });
  expect(acceptedMember()).toMatchObject({
    role: "MEMBER",
    status: "ACTIVE",
    accessSource: "DIRECT",
    workspaceType: "COMPANY",
    GSI6PK: K.userWorkspacesPK(user),
    GSI6SK: K.userWorkspaceSK("ACTIVE", org),
  });
  expect(acceptedMember()).not.toHaveProperty("productRoles");
  expect(acceptedMember()).not.toHaveProperty("cabinetRole");
  expect(
    [...rows.values()].some(
      (r) =>
        r.entityType === "PRODUCT_ACCESS" ||
        String(r.entityType).includes("RESTAURANT"),
    ),
  ).toBe(false);
  const directory = await OrganizationMemberService.list(org, owner, {
    limit: 50,
  });
  expect(directory.items).toContainEqual({
    userId: user,
    displayName: "Aïssatou S.",
    email,
    status: "ACTIVE",
  });
  seed(K.orgKey(org), K.productAccessSK("RESTAURANTS"), {
    entityType: "PRODUCT_ACCESS",
    orgId: org,
    productCode: "RESTAURANTS",
    status: "ACTIVE",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  await InitialProductRoleService.assign(org, owner, {
    clientRequestId: randomUUID(),
    memberUserId: user,
    productCode: "RESTAURANTS",
    role: "WAITER",
  });
  expect(acceptedMember()!.productRoles).toEqual({ RESTAURANTS: "WAITER" });
  expect(audits()).toHaveLength(2);
});
test.each([
  { email: "wrong@example.test" },
  { emailVerified: false },
  { emailVerified: "false" },
  { email: undefined },
])("acceptance requires matching verified email: %j", async (overrides) => {
  const invite = await create();
  await expect(
    accept(invite.invitationToken!, overrides),
  ).rejects.toMatchObject({ statusCode: 403 });
  expect(acceptedMember()).toBeUndefined();
});
test("verified email casing/whitespace follows canonical normalization", async () => {
  const invite = await create();
  await expect(
    accept(invite.invitationToken!, {
      email: " AISSA@EXAMPLE.TEST ",
      emailVerified: "true",
    }),
  ).resolves.toMatchObject({ membershipStatus: "ACTIVE" });
});
test("expired, cancelled and invalid tokens cannot create membership", async () => {
  const invite = await create();
  const row = invitations()[0];
  row.status = "CANCELLED";
  await expect(accept(invite.invitationToken!)).rejects.toMatchObject({
    messageCode: "ORGANIZATION_INVITATION_UNAVAILABLE",
  });
  row.status = "PENDING";
  jest.setSystemTime(new Date("2026-10-24T10:00:00.000Z"));
  await expect(accept(invite.invitationToken!)).rejects.toMatchObject({
    messageCode: "ORGANIZATION_INVITATION_EXPIRED",
  });
  await expect(accept(newInvitationToken().rawToken)).rejects.toMatchObject({
    statusCode: 404,
  });
  expect(acceptedMember()).toBeUndefined();
});
test("accepted invitation replay is safe after expiry, rejects another identity and never reactivates access", async () => {
  const invite = await create();
  const first = await accept(invite.invitationToken!),
    count = rows.size;
  jest.setSystemTime(new Date("2026-11-24T10:00:00.000Z"));
  expect(await accept(invite.invitationToken!)).toEqual(first);
  expect(rows.size).toBe(count);
  await expect(
    accept(invite.invitationToken!, { userId: "another" }),
  ).rejects.toMatchObject({ statusCode: 403 });
  acceptedMember()!.status = "REVOKED";
  await expect(accept(invite.invitationToken!)).rejects.toMatchObject({
    statusCode: 403,
  });
  expect(acceptedMember()!.status).toBe("REVOKED");
});
test("concurrent acceptance returns one membership and one acceptance audit", async () => {
  const invite = await create();
  const results = await Promise.all([
    accept(invite.invitationToken!),
    accept(invite.invitationToken!),
  ]);
  expect(results[0]).toEqual(results[1]);
  expect(
    audits().filter((r) => r.action === "ACCEPT_ORGANIZATION_INVITATION"),
  ).toHaveLength(1);
});
test("membership created by another path prevents acceptance; transaction race cannot overwrite it", async () => {
  const invite = await create();
  seedProfile();
  beforeCommit = () =>
    member(user, { role: "OWNER", productRoles: { RESTAURANTS: "OWNER" } });
  await expect(accept(invite.invitationToken!)).rejects.toMatchObject({
    messageCode: "ORGANIZATION_INVITATION_MEMBER_EXISTS",
  });
  expect(acceptedMember()!.role).toBe("OWNER");
  expect(invitations()[0].status).toBe("PENDING");
  expect(audits()).toHaveLength(1);
});
test("actor/organization revocation at commit fails closed without partial invitation writes", async () => {
  beforeCommit = () => {
    read(K.orgKey(org), K.orgUserAccessSK(owner))!.status = "REVOKED";
  };
  await expect(create()).rejects.toMatchObject({ statusCode: 403 });
  expect(invitations()).toHaveLength(0);
});
test("profile email changed concurrently cannot grant membership", async () => {
  const invite = await create();
  seedProfile();
  beforeCommit = () => {
    read(K.userProfilePK(user), K.userProfileSK())!.normalizedEmail =
      "other@example.test";
  };
  await expect(accept(invite.invitationToken!)).rejects.toBeDefined();
  expect(acceptedMember()).toBeUndefined();
});
test.each(["production", "test", undefined])(
  "raw tokens are unavailable outside explicit development: %s",
  async (env) => {
    if (env === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = env;
    const result = await create();
    expect(result.deliveryMode).toBe("UNAVAILABLE");
    expect(result.invitationToken).toBeUndefined();
  },
);
test("high entropy token and bounded default lifetime", () => {
  expect(
    new Set(Array.from({ length: 100 }, () => newInvitationToken().rawToken))
      .size,
  ).toBe(100);
  expect(invitationValidityMs()).toBe(7 * 86400000);
  expect(invitationValidityMs("31")).toBe(7 * 86400000);
  expect(invitationValidityMs("2")).toBe(2 * 86400000);
});
test("no raw token is logged or included in audit", async () => {
  const info = jest.spyOn(console, "info").mockImplementation(),
    error = jest.spyOn(console, "error").mockImplementation();
  try {
    const invite = await create();
    await accept(invite.invitationToken!);
    expect(
      JSON.stringify([info.mock.calls, error.mock.calls, audits()]),
    ).not.toContain(invite.invitationToken!);
  } finally {
    info.mockRestore();
    error.mockRestore();
  }
});
test("pre-tenant acceptance uses JWT identity and ignores forged client organization/user context", async () => {
  const invite = await create();
  const response = await acceptHandler({
    headers: { "accept-language": "en" },
    requestContext: {
      authorizer: {
        jwt: {
          claims: {
            sub: user,
            email,
            email_verified: "true",
            name: "Aïssatou S.",
          },
        },
      },
    },
    body: JSON.stringify({
      token: invite.invitationToken,
      orgId: "foreign",
      userId: "forged",
    }),
  });
  expect(response.statusCode).toBe(200);
  expect(acceptedMember()!.userId).toBe(user);
  expect(read(K.orgKey("foreign"), K.orgUserAccessSK(user))).toBeUndefined();
});
test("create handler derives tenant and actor; strict payload rejects roles/unknown identifiers", async () => {
  const event = {
    headers: { "x-org-id": org, "accept-language": "en" },
    requestContext: { authorizer: { jwt: { claims: { sub: owner } } } },
  };
  const valid = await createHandler({
    ...event,
    body: JSON.stringify({ ...request(), orgId: "foreign", userId: "forged" }),
  });
  expect(valid.statusCode).toBe(200);
  const invalid = await createHandler({
    ...event,
    body: JSON.stringify({ ...request(), role: "OWNER" }),
  });
  expect(invalid.statusCode).toBe(400);
  expect(
    CreateOrganizationInvitationRequestSchema.safeParse({
      ...request(),
      email: "invalid",
    }).success,
  ).toBe(false);
  expect(
    AcceptOrganizationInvitationRequestSchema.safeParse({
      token: newInvitationToken().rawToken,
      actorRole: "OWNER",
    }).success,
  ).toBe(false);
  expect(
    AcceptOrganizationInvitationResponseSchema.safeParse({
      organizationId: org,
      membershipStatus: "ACTIVE",
      productRoles: {},
    }).success,
  ).toBe(false);
  expect(
    CreateOrganizationInvitationResponseSchema.safeParse({
      invitation: {},
      tokenHash: "private",
    }).success,
  ).toBe(false);
});
test("Cabinet token cannot be accepted by COMPANY route", async () => {
  const token = newInvitationToken();
  seed(K.invitationTokenPK(token.tokenHash), K.invitationTokenSK(), {
    entityType: "INVITATION_TOKEN_LOOKUP",
    cabinetOrgId: org,
    cabinetId: "cab",
    invitationId: "inv-old",
  });
  await expect(accept(token.rawToken)).rejects.toMatchObject({
    statusCode: 404,
  });
  expect(acceptedMember()).toBeUndefined();
});

test("development token exposure still requires explicit opt-in", async () => {
  delete process.env.ORGANIZATION_INVITATION_EXPOSE_TOKEN;
  expect(await create()).toMatchObject({ deliveryMode: "UNAVAILABLE" });
});
test("member/organization state changing during acceptance cannot leave a partially accepted invitation", async () => {
  const invite = await create();
  seedProfile();
  beforeCommit = () => {
    read(K.orgKey(org), K.organizationSK())!.status = "INACTIVE";
  };
  await expect(accept(invite.invitationToken!)).rejects.toMatchObject({
    statusCode: 403,
  });
  expect(acceptedMember()).toBeUndefined();
  expect(invitations()[0].status).toBe("PENDING");
  expect(audits()).toHaveLength(1);
});
test("an actor request ID cannot be replayed with another organization", async () => {
  const intent = request(),
    first = await create(intent);
  seed(K.orgKey("company-b"), K.organizationSK(), {
    entityType: "ORGANIZATION",
    orgId: "company-b",
    workspaceType: "COMPANY",
    status: "ACTIVE",
  });
  member(owner, { role: "OWNER" }, "company-b");
  await expect(create(intent, owner, "company-b")).rejects.toMatchObject({
    messageCode: "ORGANIZATION_INVITATION_IDEMPOTENCY_CONFLICT",
  });
  expect(
    await R.invitation("company-b", first.invitation.invitationId),
  ).toBeUndefined();
});
test("unsupported membership source cannot be silently replaced during acceptance", async () => {
  const invite = await create();
  member(user, { accessSource: "CABINET_LINK" });
  await expect(accept(invite.invitationToken!)).rejects.toMatchObject({
    messageCode: "ORGANIZATION_INVITATION_MEMBER_EXISTS",
  });
  expect(acceptedMember()!.accessSource).toBe("CABINET_LINK");
});
test("profile lookup with no canonical verified profile fails closed", async () => {
  seedProfile();
  read(K.userProfilePK(user), K.userProfileSK())!.normalizedEmail =
    "other@example.test";
  await expect(create()).rejects.toMatchObject({
    messageCode: "USER_PROFILE_EMAIL_CONFLICT",
  });
  expect(invitations()).toHaveLength(0);
});

test("malformed acceptance JSON cannot leak any raw token through generic error logs", async () => {
  const token = newInvitationToken().rawToken;
  const error = jest.spyOn(console, "error").mockImplementation();
  try {
    const response = await acceptHandler({
      headers: { "accept-language": "en" },
      requestContext: {
        authorizer: {
          jwt: { claims: { sub: user, email, email_verified: "true" } },
        },
      },
      body: token,
    });
    expect(response.statusCode).toBe(400);
    expect(error).not.toHaveBeenCalled();
    expect(response.body).not.toContain(token);
  } finally {
    error.mockRestore();
  }
});

test("OWNER cannot invite their own canonical identity, including during membership races", async () => {
  seedProfile(owner, email);
  await expect(create()).rejects.toMatchObject({
    messageCode: "ORGANIZATION_INVITATION_MEMBER_EXISTS",
  });
  expect(db.commandCalls(TransactWriteItemsCommand)).toHaveLength(0);
});
