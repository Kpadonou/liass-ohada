import {
  BatchGetItemCommand,
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  QueryCommand,
  ScanCommand,
  UpdateItemCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { mockClient } from "aws-sdk-client-mock";
import { CabinetOperationsService } from "@/lambda/shared/services/cabinet-operations-service";

const dynamoMock = mockClient(DynamoDBClient);

const context = {
  orgId: "org-cabinet",
  userId: "admin-1",
  cabinetId: "cab-123",
  workspaceType: "ACCOUNTING_FIRM" as const,
};

const activeMember = (userId: string, cabinetRole = "CABINET_ADMIN") =>
  marshall({
    entityType: "USER_ORG_ACCESS",
    orgId: "org-cabinet",
    userId,
    cabinetId: "cab-123",
    cabinetRole,
    workspaceType: "ACCOUNTING_FIRM",
    status: "ACTIVE",
    updatedAt: "2026-07-26T00:00:00.000Z",
  });

const assignmentItem = (userId: string, dossierOrgId = "org-client") =>
  marshall({
    PK: "CABINET#org-cabinet",
    SK: `ASSIGNMENT#USER#${userId}#DOSSIER#${dossierOrgId}`,
    entityType: "CABINET_DOSSIER_ASSIGNMENT",
    cabinetOrgId: "org-cabinet",
    userId,
    dossierOrgId,
    assignedBy: "admin-1",
    assignedAt: "2026-07-01T00:00:00.000Z",
  });

const currentDossierResponse = {
  Responses: {
    "liass-ohada-test-accounting-table": [
      marshall({
        PK: "CABINET#cab-123",
        SK: "DOSSIER#org-client",
        entityType: "CABINET_DOSSIER",
        cabinetId: "cab-123",
        orgId: "org-client",
        relationship: "CLIENT",
        status: "ACTIVE",
      }),
      marshall({
        PK: "ORG#org-client",
        SK: "ORG#METADATA",
        entityType: "ORGANIZATION",
        orgId: "org-client",
        name: "Client SARL",
        country: "BJ",
        accountingFramework: "SYSCOHADA_REVISED",
        workspaceType: "COMPANY",
        status: "ACTIVE",
      }),
    ],
  },
};

const workItem = {
  PK: "CABINET#org-cabinet",
  SK: "WORK#wrk-1",
  entityType: "ACCOUNTING_WORK",
  workId: "wrk-1",
  cabinetOrgId: "org-cabinet",
  dossierOrgId: "org-client",
  type: "MONTHLY_CLOSE",
  title: "Clôture mensuelle",
  dueDate: "2026-08-10",
  priority: "NORMAL",
  status: "TO_DO",
  responsibleUserId: "collab-1",
  participantUserIds: ["collab-2"],
  createdBy: "admin-1",
  createdAt: "2026-07-26T00:00:00.000Z",
  updatedBy: "admin-1",
  updatedAt: "2026-07-26T00:00:00.000Z",
};

describe("CabinetOperationsService", () => {
  beforeEach(() => {
    dynamoMock.reset();
    jest.clearAllMocks();
  });

  test("Cabinet Admin creates Work under the Cabinet partition with sparse GSI keys", async () => {
    dynamoMock.on(GetItemCommand).callsFake((input) => {
      const sk = input.Key?.SK?.S;
      if (sk === "USER#admin-1") return { Item: activeMember("admin-1") };
      if (sk === "USER#collab-1") {
        return { Item: activeMember("collab-1", "COLLABORATOR") };
      }
      if (sk === "ASSIGNMENT#USER#collab-1#DOSSIER#org-client") {
        return { Item: assignmentItem("collab-1") };
      }
      return {};
    });
    dynamoMock.on(BatchGetItemCommand).resolves(currentDossierResponse);
    dynamoMock.on(PutItemCommand).resolves({});

    const response = await CabinetOperationsService.createWork(context, {
      dossierOrgId: "org-client",
      type: "MONTHLY_CLOSE",
      title: "Clôture mensuelle",
      dueDate: "2026-08-10",
      priority: "NORMAL",
      responsibleUserId: "collab-1",
      participantUserIds: [],
    });

    expect(response.work).toMatchObject({
      cabinetOrgId: "org-cabinet",
      dossierOrgId: "org-client",
      status: "TO_DO",
    });
    const put = dynamoMock.commandCalls(PutItemCommand)[0].args[0].input;
    expect(unmarshall(put.Item ?? {})).toMatchObject({
      PK: "CABINET#org-cabinet",
      entityType: "ACCOUNTING_WORK",
      GSI1PK: "CABINET#org-cabinet#WORKS",
      GSI1SK: expect.stringContaining("DUE#2026-08-10#WORK#"),
      GSI2PK: "CABINET#org-cabinet#DOSSIER#org-client#WORKS",
      GSI3PK: "CABINET#org-cabinet#USER#collab-1#WORKS",
    });
    expect(put.ConditionExpression).toBe(
      "attribute_not_exists(PK) AND attribute_not_exists(SK)",
    );
    expect(dynamoMock.commandCalls(ScanCommand)).toHaveLength(0);
  });

  test("Collaborator cannot structurally create Work", async () => {
    dynamoMock.on(GetItemCommand).resolves({
      Item: activeMember("admin-1", "COLLABORATOR"),
    });

    await expect(
      CabinetOperationsService.createWork(context, {
        dossierOrgId: "org-client",
        type: "MONTHLY_CLOSE",
        title: "Clôture mensuelle",
        priority: "NORMAL",
        participantUserIds: [],
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(dynamoMock.commandCalls(PutItemCommand)).toHaveLength(0);
  });

  test("dossier-filter Work listing uses GSI2 and never Scan", async () => {
    dynamoMock.on(GetItemCommand).resolves({ Item: activeMember("admin-1") });
    dynamoMock.on(QueryCommand).resolves({
      Items: [marshall({ ...workItem, GSI2PK: "x", GSI2SK: "x" })],
    });

    const response = await CabinetOperationsService.listWorks(context, {
      dossierOrgId: "org-client",
      limit: 20,
    });

    expect(response.works).toHaveLength(1);
    expect(dynamoMock.commandCalls(QueryCommand)[0].args[0].input).toMatchObject({
      IndexName: "GSI2",
      KeyConditionExpression: "#pk = :pk AND #sk BETWEEN :from AND :to",
      ExpressionAttributeValues: {
        ":pk": { S: "CABINET#org-cabinet#DOSSIER#org-client#WORKS" },
      },
    });
    expect(dynamoMock.commandCalls(ScanCommand)).toHaveLength(0);
  });

  test("assigned Collaborator may complete assigned Work but may not cancel it", async () => {
    const collaboratorContext = { ...context, userId: "collab-1" };
    dynamoMock.on(GetItemCommand).callsFake((input) => {
      const sk = input.Key?.SK?.S;
      if (sk === "USER#collab-1") {
        return { Item: activeMember("collab-1", "COLLABORATOR") };
      }
      if (sk === "WORK#wrk-1") return { Item: marshall(workItem) };
      if (sk === "ASSIGNMENT#USER#collab-1#DOSSIER#org-client") {
        return { Item: assignmentItem("collab-1") };
      }
      return {};
    });
    dynamoMock.on(UpdateItemCommand).resolves({
      Attributes: marshall({
        ...workItem,
        status: "COMPLETED",
        completedAt: "2026-07-26T01:00:00.000Z",
        completedBy: "collab-1",
      }),
    });

    await expect(
      CabinetOperationsService.updateWorkStatus(collaboratorContext, {
        workId: "wrk-1",
        status: "COMPLETED",
      }),
    ).resolves.toMatchObject({
      work: { completedBy: "collab-1", status: "COMPLETED" },
    });
    await expect(
      CabinetOperationsService.updateWorkStatus(collaboratorContext, {
        workId: "wrk-1",
        status: "CANCELLED",
      }),
    ).rejects.toMatchObject({
      messageCode: "CABINET_WORK_CANCEL_FORBIDDEN",
      statusCode: 403,
    });
  });

  test("Deadline overdue listing derives overdue from due date and PENDING status", async () => {
    dynamoMock.on(GetItemCommand).resolves({ Item: activeMember("admin-1") });
    const deadlineBase = {
      PK: "CABINET#org-cabinet",
      cabinetOrgId: "org-cabinet",
      dossierOrgId: "org-client",
      title: "Déclaration TVA",
      priority: "NORMAL",
      responsibleUserId: "collab-1",
      createdBy: "admin-1",
      createdAt: "2026-07-26T00:00:00.000Z",
      updatedBy: "admin-1",
      updatedAt: "2026-07-26T00:00:00.000Z",
    };
    dynamoMock.on(QueryCommand).resolves({
      Items: [
        marshall({
          ...deadlineBase,
          entityType: "CABINET_DEADLINE",
          SK: "DEADLINE#ddl-1",
          deadlineId: "ddl-1",
          type: "TAX",
          dueDate: "2026-01-10",
          status: "PENDING",
        }),
        marshall({
          ...deadlineBase,
          entityType: "CABINET_DEADLINE",
          SK: "DEADLINE#ddl-2",
          deadlineId: "ddl-2",
          type: "TAX",
          dueDate: "2026-01-10",
          status: "COMPLETED",
        }),
      ],
    });

    const response = await CabinetOperationsService.listDeadlines(context, {
      overdue: true,
    });

    expect(response.deadlines).toHaveLength(1);
    expect(response.deadlines[0].deadlineId).toBe("ddl-1");
    expect(dynamoMock.commandCalls(QueryCommand)[0].args[0].input).toMatchObject({
      IndexName: "GSI1",
      ExpressionAttributeValues: expect.objectContaining({
        ":pk": { S: "CABINET#org-cabinet#DEADLINES" },
      }),
    });
    expect(dynamoMock.commandCalls(ScanCommand)).toHaveLength(0);
  });
});
