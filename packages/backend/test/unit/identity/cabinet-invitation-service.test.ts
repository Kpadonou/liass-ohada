import {
  DynamoDBClient,
  GetItemCommand,
  QueryCommand,
  ScanCommand,
  TransactWriteItemsCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { mockClient } from "aws-sdk-client-mock";
import {
  CabinetInvitationSecurity,
  CabinetInvitationService,
} from "@/lambda/shared/services/cabinet-invitation-service";

const dynamoMock = mockClient(DynamoDBClient);
const now = "2099-07-19T12:00:00.000Z";
const context = {
  orgId: "org-cabinet",
  userId: "admin-1",
  cabinetId: "cab-1",
  workspaceType: "ACCOUNTING_FIRM" as const,
};

const adminItem = marshall({
  PK: "ORG#org-cabinet",
  SK: "USER#admin-1",
  entityType: "USER_ORG_ACCESS",
  orgId: "org-cabinet",
  userId: "admin-1",
  role: "OWNER",
  cabinetRole: "CABINET_ADMIN",
  status: "ACTIVE",
  cabinetId: "cab-1",
  accessSource: "DIRECT",
  workspaceType: "ACCOUNTING_FIRM",
  createdAt: now,
  updatedAt: now,
  GSI6PK: "USER#admin-1",
  GSI6SK: "STATUS#ACTIVE#ORG#org-cabinet",
});

function invitationItem(
  tokenHash: string,
  status: "PENDING" | "ACCEPTED" | "EXPIRED" | "CANCELLED" = "PENDING",
) {
  return marshall({
    PK: "CABINET#org-cabinet",
    SK: "INV#inv-1",
    entityType: "CABINET_INVITATION",
    invitationId: "inv-1",
    cabinetOrgId: "org-cabinet",
    cabinetId: "cab-1",
    normalizedEmail: "member@example.com",
    displayEmail: "member@example.com",
    role: "COLLABORATOR",
    status,
    invitedBy: "admin-1",
    createdAt: now,
    updatedAt: now,
    expiresAt: "2099-07-26T12:00:00.000Z",
    tokenHash,
    initialDossierOrgIds: [],
    GSI1PK: "CABINET#org-cabinet#INVITATIONS",
    GSI1SK: `STATUS#${status}#CREATED#${now}#INV#inv-1`,
  });
}

function mockAdminAccess() {
  dynamoMock.on(GetItemCommand).resolves({});
  dynamoMock
    .on(GetItemCommand, {
      Key: {
        PK: { S: "ORG#org-cabinet" },
        SK: { S: "USER#admin-1" },
      },
    })
    .resolves({ Item: adminItem });
}

describe("CabinetInvitationService", () => {
  beforeEach(() => {
    dynamoMock.reset();
    jest.clearAllMocks();
    process.env.CABINET_INVITATION_EXPOSE_TOKEN = "true";
  });

  afterEach(() => {
    delete process.env.CABINET_INVITATION_EXPOSE_TOKEN;
  });

  test("creates invitation, normalized-email lock, and hashed-token lookup atomically", async () => {
    mockAdminAccess();
    dynamoMock.on(QueryCommand).resolves({ Items: [adminItem] });
    dynamoMock.on(TransactWriteItemsCommand).resolves({});

    const response = await CabinetInvitationService.createInvitation(context, {
      email: "member@example.com",
      role: "COLLABORATOR",
      initialDossierOrgIds: [],
    });
    const transaction =
      dynamoMock.commandCalls(TransactWriteItemsCommand)[0].args[0].input;
    const items = (transaction.TransactItems ?? []).map((item) =>
      unmarshall(item.Put?.Item ?? {}),
    );

    expect(response.invitation.email).toBe("member@example.com");
    expect(response.invitationToken).toEqual(expect.any(String));
    expect(items.map((item) => item.entityType)).toEqual([
      "CABINET_INVITATION",
      "INVITATION_EMAIL_LOCK",
      "INVITATION_TOKEN_LOOKUP",
    ]);
    expect(items[0].tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(items[0]).not.toHaveProperty("token");
    expect(items[2].PK).toBe(`INVITE_TOKEN#${items[0].tokenHash}`);
    expect(JSON.stringify(transaction)).not.toContain(response.invitationToken);
    expect(dynamoMock.commandCalls(ScanCommand)).toHaveLength(0);
  });

  test("does not expose a raw token unless explicitly enabled outside production", async () => {
    delete process.env.CABINET_INVITATION_EXPOSE_TOKEN;
    mockAdminAccess();
    dynamoMock.on(QueryCommand).resolves({ Items: [adminItem] });
    dynamoMock.on(TransactWriteItemsCommand).resolves({});

    const response = await CabinetInvitationService.createInvitation(context, {
      email: "member@example.com",
      role: "READER",
      initialDossierOrgIds: [],
    });

    expect(response.invitationToken).toBeUndefined();
  });

  test("lists invitations through the sparse GSI1 status prefix", async () => {
    mockAdminAccess();
    const tokenHash = "a".repeat(64);
    dynamoMock.on(QueryCommand).resolves({ Items: [invitationItem(tokenHash)] });

    const response = await CabinetInvitationService.listInvitations(context, {
      status: "PENDING",
      limit: 20,
    });
    const query = dynamoMock.commandCalls(QueryCommand)[0].args[0].input;

    expect(response.invitations).toHaveLength(1);
    expect(query.IndexName).toBe("GSI1");
    expect(query.ExpressionAttributeValues).toMatchObject({
      ":pk": { S: "CABINET#org-cabinet#INVITATIONS" },
      ":statusPrefix": { S: "STATUS#PENDING#" },
    });
  });

  test("cancels a pending invitation and removes lock and token lookup in one transaction", async () => {
    mockAdminAccess();
    const tokenHash = "b".repeat(64);
    dynamoMock
      .on(GetItemCommand, {
        Key: {
          PK: { S: "CABINET#org-cabinet" },
          SK: { S: "INV#inv-1" },
        },
      })
      .resolves({ Item: invitationItem(tokenHash) });
    dynamoMock.on(TransactWriteItemsCommand).resolves({});

    const response = await CabinetInvitationService.cancelInvitation(
      context,
      "inv-1",
    );
    const transaction =
      dynamoMock.commandCalls(TransactWriteItemsCommand)[0].args[0].input;

    expect(response.invitation.status).toBe("CANCELLED");
    expect(transaction.TransactItems).toHaveLength(3);
    expect(transaction.TransactItems?.[0].Update?.UpdateExpression).toContain(
      "GSI1SK",
    );
    expect(
      unmarshall(transaction.TransactItems?.[2].Delete?.Key ?? {}),
    ).toEqual({ PK: `INVITE_TOKEN#${tokenHash}`, SK: "LOOKUP" });
  });

  test("accepts only the matching verified Cognito email through hashed lookup", async () => {
    const rawToken = "valid-token-value-with-more-than-thirty-two-characters";
    const tokenHash = CabinetInvitationSecurity.hashToken(rawToken);
    dynamoMock.on(GetItemCommand).resolves({});
    dynamoMock
      .on(GetItemCommand, {
        Key: {
          PK: { S: `INVITE_TOKEN#${tokenHash}` },
          SK: { S: "LOOKUP" },
        },
      })
      .resolves({
        Item: marshall({
          PK: `INVITE_TOKEN#${tokenHash}`,
          SK: "LOOKUP",
          entityType: "INVITATION_TOKEN_LOOKUP",
          cabinetOrgId: "org-cabinet",
          cabinetId: "cab-1",
          invitationId: "inv-1",
          normalizedEmail: "member@example.com",
          expiresAt: "2099-07-26T12:00:00.000Z",
          createdAt: now,
        }),
      });
    dynamoMock
      .on(GetItemCommand, {
        Key: {
          PK: { S: "CABINET#org-cabinet" },
          SK: { S: "INV#inv-1" },
        },
      })
      .resolves({ Item: invitationItem(tokenHash) });
    dynamoMock
      .on(GetItemCommand, {
        Key: {
          PK: { S: "ORG#org-cabinet" },
          SK: { S: "ORG#METADATA" },
        },
      })
      .resolves({
        Item: marshall({
          PK: "ORG#org-cabinet",
          SK: "ORG#METADATA",
          entityType: "ORGANIZATION",
          orgId: "org-cabinet",
          name: "Cabinet Demo",
          workspaceType: "ACCOUNTING_FIRM",
          status: "ACTIVE",
          country: "BJ",
          accountingFramework: "SYSCOHADA_REVISED",
        }),
      });
    dynamoMock.on(TransactWriteItemsCommand).resolves({});

    const response = await CabinetInvitationService.acceptInvitation(rawToken, {
      userId: "member-1",
      email: "Member@Example.com",
      emailVerified: "true",
      givenName: "Ada",
      familyName: "Mensah",
    });
    const transaction =
      dynamoMock.commandCalls(TransactWriteItemsCommand)[0].args[0].input;
    const access = unmarshall(
      transaction.TransactItems?.[0].Put?.Item ?? {},
    );

    expect(response.member).toMatchObject({
      userId: "member-1",
      cabinetRole: "COLLABORATOR",
      status: "ACTIVE",
      email: "member@example.com",
    });
    expect(access).toMatchObject({
      entityType: "USER_ORG_ACCESS",
      orgId: "org-cabinet",
      userId: "member-1",
      cabinetRole: "COLLABORATOR",
      status: "ACTIVE",
      GSI6SK: "STATUS#ACTIVE#ORG#org-cabinet",
    });
    expect(transaction.TransactItems).toHaveLength(4);
  });

  test("rejects an authenticated user with the wrong email before writing", async () => {
    const rawToken = "valid-token-value-with-more-than-thirty-two-characters";
    const tokenHash = CabinetInvitationSecurity.hashToken(rawToken);
    dynamoMock.on(GetItemCommand).resolves({});
    dynamoMock
      .on(GetItemCommand, {
        Key: {
          PK: { S: `INVITE_TOKEN#${tokenHash}` },
          SK: { S: "LOOKUP" },
        },
      })
      .resolves({
        Item: marshall({
          entityType: "INVITATION_TOKEN_LOOKUP",
          cabinetOrgId: "org-cabinet",
          cabinetId: "cab-1",
          invitationId: "inv-1",
          normalizedEmail: "member@example.com",
          expiresAt: "2099-07-26T12:00:00.000Z",
          createdAt: now,
        }),
      });
    dynamoMock
      .on(GetItemCommand, {
        Key: {
          PK: { S: "CABINET#org-cabinet" },
          SK: { S: "INV#inv-1" },
        },
      })
      .resolves({ Item: invitationItem(tokenHash) });

    await expect(
      CabinetInvitationService.acceptInvitation(rawToken, {
        userId: "attacker-1",
        email: "other@example.com",
        emailVerified: true,
      }),
    ).rejects.toMatchObject({
      statusCode: 403,
      messageCode: "CABINET_INVITATION_EMAIL_MISMATCH",
    });
    expect(dynamoMock.commandCalls(TransactWriteItemsCommand)).toHaveLength(0);
  });
});
