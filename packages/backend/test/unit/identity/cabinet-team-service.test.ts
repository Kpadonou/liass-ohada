import {
  BatchGetItemCommand,
  DynamoDBClient,
  GetItemCommand,
  QueryCommand,
  ScanCommand,
  TransactWriteItemsCommand,
  UpdateItemCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { mockClient } from "aws-sdk-client-mock";
import { CabinetTeamService } from "@/lambda/shared/services/cabinet-team-service";

const dynamoMock = mockClient(DynamoDBClient);
const now = "2026-07-19T12:00:00.000Z";
const context = {
  orgId: "org-cabinet",
  userId: "admin-1",
  cabinetId: "cab-1",
  workspaceType: "ACCOUNTING_FIRM" as const,
};

function memberItem(
  userId: string,
  cabinetRole: "CABINET_ADMIN" | "SUPERVISOR" | "COLLABORATOR" | "READER",
  status: "ACTIVE" | "SUSPENDED" | "REVOKED" = "ACTIVE",
) {
  return marshall({
    PK: "ORG#org-cabinet",
    SK: `USER#${userId}`,
    entityType: "USER_ORG_ACCESS",
    orgId: "org-cabinet",
    userId,
    role: userId === "admin-1" ? "OWNER" : "MEMBER",
    cabinetRole,
    status,
    cabinetId: "cab-1",
    accessSource: "DIRECT",
    workspaceType: "ACCOUNTING_FIRM",
    createdAt: now,
    updatedAt: now,
    GSI6PK: `USER#${userId}`,
    GSI6SK: `STATUS#${status}#ORG#org-cabinet`,
  });
}

function cabinetItem(ownerUserId = "admin-1") {
  return marshall({
    PK: "CABINET#cab-1",
    SK: "CABINET#METADATA",
    entityType: "CABINET",
    cabinetId: "cab-1",
    orgId: "org-cabinet",
    ownerUserId,
    status: "ACTIVE",
  });
}

describe("CabinetTeamService", () => {
  beforeEach(() => {
    dynamoMock.reset();
    jest.clearAllMocks();
  });

  test("lists members with an organization-partition Query and never Scan", async () => {
    dynamoMock.on(GetItemCommand).resolves({ Item: memberItem("admin-1", "CABINET_ADMIN") });
    dynamoMock
      .on(GetItemCommand, {
        Key: { PK: { S: "CABINET#cab-1" }, SK: { S: "CABINET#METADATA" } },
      })
      .resolves({ Item: cabinetItem() });
    dynamoMock.on(QueryCommand).resolves({
      Items: [
        memberItem("admin-1", "CABINET_ADMIN"),
        memberItem("member-1", "COLLABORATOR"),
      ],
    });
    dynamoMock.on(BatchGetItemCommand).resolves({
      Responses: { "liass-ohada-test-accounting-table": [] },
    });

    const response = await CabinetTeamService.listMembers(context, {
      limit: 25,
      status: "ACTIVE",
    });
    const query = dynamoMock.commandCalls(QueryCommand)[0].args[0].input;

    expect(response.members).toHaveLength(2);
    expect(response.members[0]).toMatchObject({ userId: "admin-1", isOwner: true });
    expect(response.members[1]).toMatchObject({ userId: "member-1", isOwner: false });
    expect(query.IndexName).toBeUndefined();
    expect(query.KeyConditionExpression).toBe(
      "PK = :pk AND begins_with(SK, :prefix)",
    );
    expect(query.ExpressionAttributeValues).toMatchObject({
      ":pk": { S: "ORG#org-cabinet" },
      ":prefix": { S: "USER#" },
    });
    expect(dynamoMock.commandCalls(ScanCommand)).toHaveLength(0);
  });

  test("allows a legacy Cabinet owner whose access row predates cabinetRole", async () => {
    const legacyOwner = unmarshall(memberItem("admin-1", "CABINET_ADMIN"));
    delete legacyOwner.cabinetRole;
    dynamoMock.on(GetItemCommand).resolves({ Item: marshall(legacyOwner) });
    dynamoMock
      .on(GetItemCommand, {
        Key: { PK: { S: "CABINET#cab-1" }, SK: { S: "CABINET#METADATA" } },
      })
      .resolves({ Item: cabinetItem() });
    dynamoMock.on(QueryCommand).resolves({ Items: [marshall(legacyOwner)] });
    dynamoMock.on(BatchGetItemCommand).resolves({
      Responses: { "liass-ohada-test-accounting-table": [] },
    });

    const response = await CabinetTeamService.listMembers(context, { limit: 25 });

    expect(response.members[0]).toMatchObject({
      userId: "admin-1",
      cabinetRole: "CABINET_ADMIN",
      isOwner: true,
    });
  });

  test("allows a Supervisor to list active members but not suspended members", async () => {
    dynamoMock.on(GetItemCommand).resolves({
      Item: memberItem("supervisor-1", "SUPERVISOR"),
    });
    await expect(
      CabinetTeamService.listMembers(
        { ...context, userId: "supervisor-1" },
        { status: "SUSPENDED" },
      ),
    ).rejects.toMatchObject({
      statusCode: 403,
      messageCode: "CABINET_MEMBER_ROLE_FORBIDDEN",
    });
    expect(dynamoMock.commandCalls(QueryCommand)).toHaveLength(0);
  });

  test("prevents demoting the Cabinet owner", async () => {
    dynamoMock.on(GetItemCommand).resolves({ Item: memberItem("admin-1", "CABINET_ADMIN") });
    dynamoMock
      .on(GetItemCommand, {
        Key: { PK: { S: "CABINET#cab-1" }, SK: { S: "CABINET#METADATA" } },
      })
      .resolves({ Item: cabinetItem() });

    await expect(
      CabinetTeamService.updateMemberRole(context, "admin-1", {
        role: "SUPERVISOR",
      }),
    ).rejects.toMatchObject({
      statusCode: 409,
      messageCode: "CABINET_OWNER_ROLE_IMMUTABLE",
    });
    expect(dynamoMock.commandCalls(UpdateItemCommand)).toHaveLength(0);
  });

  test("prevents suspending or revoking the Cabinet owner", async () => {
    dynamoMock.on(GetItemCommand).resolves({ Item: memberItem("admin-1", "CABINET_ADMIN") });
    dynamoMock
      .on(GetItemCommand, {
        Key: { PK: { S: "CABINET#cab-1" }, SK: { S: "CABINET#METADATA" } },
      })
      .resolves({ Item: cabinetItem() });

    await expect(
      CabinetTeamService.updateMemberStatus(context, "admin-1", {
        status: "REVOKED",
      }),
    ).rejects.toMatchObject({
      statusCode: 409,
      messageCode: "CABINET_OWNER_STATUS_IMMUTABLE",
    });
    expect(dynamoMock.commandCalls(UpdateItemCommand)).toHaveLength(0);
  });

  test("fails safely when legacy Cabinet ownership is not configured", async () => {
    dynamoMock
      .on(GetItemCommand, {
        Key: { PK: { S: "ORG#org-cabinet" }, SK: { S: "USER#admin-1" } },
      })
      .resolves({ Item: memberItem("admin-1", "CABINET_ADMIN") });
    dynamoMock
      .on(GetItemCommand, {
        Key: { PK: { S: "ORG#org-cabinet" }, SK: { S: "USER#member-1" } },
      })
      .resolves({ Item: memberItem("member-1", "COLLABORATOR") });
    dynamoMock
      .on(GetItemCommand, {
        Key: { PK: { S: "CABINET#cab-1" }, SK: { S: "CABINET#METADATA" } },
      })
      .resolves({
        Item: marshall({
          entityType: "CABINET",
          cabinetId: "cab-1",
          orgId: "org-cabinet",
          status: "ACTIVE",
        }),
      });

    await expect(
      CabinetTeamService.updateMemberStatus(context, "member-1", {
        status: "SUSPENDED",
      }),
    ).rejects.toMatchObject({
      statusCode: 409,
      messageCode: "CABINET_OWNER_NOT_CONFIGURED",
    });
  });

  test("suspends a member and moves workspace discovery out of ACTIVE", async () => {
    dynamoMock
      .on(GetItemCommand, {
        Key: {
          PK: { S: "ORG#org-cabinet" },
          SK: { S: "USER#admin-1" },
        },
      })
      .resolves({ Item: memberItem("admin-1", "CABINET_ADMIN") });
    dynamoMock
      .on(GetItemCommand, {
        Key: {
          PK: { S: "ORG#org-cabinet" },
          SK: { S: "USER#member-1" },
        },
      })
      .resolves({ Item: memberItem("member-1", "COLLABORATOR") });
    dynamoMock
      .on(GetItemCommand, {
        Key: { PK: { S: "CABINET#cab-1" }, SK: { S: "CABINET#METADATA" } },
      })
      .resolves({ Item: cabinetItem() });
    dynamoMock.on(UpdateItemCommand).resolves({
      Attributes: memberItem("member-1", "COLLABORATOR", "SUSPENDED"),
    });

    const response = await CabinetTeamService.updateMemberStatus(
      context,
      "member-1",
      { status: "SUSPENDED" },
    );
    const update = dynamoMock.commandCalls(UpdateItemCommand)[0].args[0].input;

    expect(response.member.status).toBe("SUSPENDED");
    expect(update.ExpressionAttributeValues?.[":gsi6sk"]).toEqual({
      S: "STATUS#SUSPENDED#ORG#org-cabinet",
    });
  });

  test("replaces assignments without rewriting unchanged records", async () => {
    dynamoMock
      .on(GetItemCommand, {
        Key: {
          PK: { S: "ORG#org-cabinet" },
          SK: { S: "USER#admin-1" },
        },
      })
      .resolves({ Item: memberItem("admin-1", "CABINET_ADMIN") });
    dynamoMock
      .on(GetItemCommand, {
        Key: {
          PK: { S: "ORG#org-cabinet" },
          SK: { S: "USER#member-1" },
        },
      })
      .resolves({ Item: memberItem("member-1", "COLLABORATOR") });
    dynamoMock.on(BatchGetItemCommand).resolves({
      Responses: {
        "liass-ohada-test-accounting-table": [
          marshall({
            PK: "CABINET#cab-1",
            SK: "DOSSIER#org-client-1",
            entityType: "CABINET_DOSSIER",
            cabinetId: "cab-1",
            orgId: "org-client-1",
            displayName: "Client One",
            status: "ACTIVE",
            relationship: "CLIENT",
          }),
          marshall({
            PK: "CABINET#cab-1",
            SK: "DOSSIER#org-client-2",
            entityType: "CABINET_DOSSIER",
            cabinetId: "cab-1",
            orgId: "org-client-2",
            displayName: "Client Two",
            status: "ACTIVE",
            relationship: "CLIENT",
          }),
        ],
      },
    });
    dynamoMock.on(QueryCommand).resolves({
      Items: [
        marshall({
          PK: "CABINET#org-cabinet",
          SK: "ASSIGNMENT#USER#member-1#DOSSIER#org-client-1",
          entityType: "CABINET_DOSSIER_ASSIGNMENT",
          cabinetOrgId: "org-cabinet",
          userId: "member-1",
          dossierOrgId: "org-client-1",
          assignedBy: "admin-1",
          assignedAt: now,
        }),
      ],
    });
    dynamoMock.on(TransactWriteItemsCommand).resolves({});

    const response = await CabinetTeamService.replaceMemberAssignments(
      context,
      "member-1",
      { dossierOrgIds: ["org-client-1", "org-client-2"] },
    );
    const transaction =
      dynamoMock.commandCalls(TransactWriteItemsCommand)[0].args[0].input;

    expect(response.assignments).toHaveLength(2);
    expect(transaction.TransactItems).toHaveLength(1);
    expect(
      unmarshall(transaction.TransactItems?.[0].Put?.Item ?? {}),
    ).toMatchObject({
      userId: "member-1",
      dossierOrgId: "org-client-2",
      GSI1PK: "CABINET#org-cabinet#DOSSIER#org-client-2#ASSIGNMENTS",
      GSI1SK: "USER#member-1",
    });
  });
});
