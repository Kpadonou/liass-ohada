import {
  BatchGetItemCommand,
  DynamoDBClient,
  ScanCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall } from "@aws-sdk/util-dynamodb";
import { mockClient } from "aws-sdk-client-mock";
import { AccountingAuthorizationRepository } from "@/lambda/shared/repositories/accounting-authorization-repository";

const dynamoMock = mockClient(DynamoDBClient);
const tableName = "liass-ohada-test-accounting-table";

describe("AccountingAuthorizationRepository", () => {
  beforeEach(() => dynamoMock.reset());

  test("batch-loads relationship, organization and assignment by exact strongly consistent keys", async () => {
    dynamoMock.on(BatchGetItemCommand).resolves({
      Responses: {
        [tableName]: [
          marshall({
            PK: "CABINET#cab-1",
            SK: "DOSSIER#dossier-1",
            entityType: "CABINET_DOSSIER",
            cabinetId: "cab-1",
            orgId: "dossier-1",
            relationship: "CLIENT",
            status: "ACTIVE",
          }),
          marshall({
            PK: "ORG#dossier-1",
            SK: "ORG#METADATA",
            entityType: "ORGANIZATION",
            orgId: "dossier-1",
            workspaceType: "COMPANY",
            status: "ACTIVE",
          }),
          marshall({
            PK: "CABINET#cabinet-org-1",
            SK: "ASSIGNMENT#USER#member-1#DOSSIER#dossier-1",
            entityType: "CABINET_DOSSIER_ASSIGNMENT",
            cabinetOrgId: "cabinet-org-1",
            userId: "member-1",
            dossierOrgId: "dossier-1",
          }),
        ],
      },
    });

    await expect(
      AccountingAuthorizationRepository.getSnapshot({
        cabinetId: "cab-1",
        cabinetOrgId: "cabinet-org-1",
        dossierOrgId: "dossier-1",
        includeAssignment: true,
        userId: "member-1",
      }),
    ).resolves.toMatchObject({ assignmentExists: true });

    const request = dynamoMock.commandCalls(BatchGetItemCommand)[0].args[0].input;
    expect(request.RequestItems?.[tableName]).toMatchObject({
      ConsistentRead: true,
      Keys: [
        { PK: { S: "CABINET#cab-1" }, SK: { S: "DOSSIER#dossier-1" } },
        { PK: { S: "ORG#dossier-1" }, SK: { S: "ORG#METADATA" } },
        {
          PK: { S: "CABINET#cabinet-org-1" },
          SK: { S: "ASSIGNMENT#USER#member-1#DOSSIER#dossier-1" },
        },
      ],
    });
    expect(dynamoMock.commandCalls(ScanCommand)).toHaveLength(0);
  });
});
