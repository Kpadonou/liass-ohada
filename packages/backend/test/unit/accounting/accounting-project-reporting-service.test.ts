import { AccountingProjectReportingService } from "@/lambda/domains/accounting/reporting/accounting-project-reporting-service";
import {
  DynamoDBClient,
  QueryCommand,
  ScanCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall } from "@aws-sdk/util-dynamodb";
import { mockClient } from "aws-sdk-client-mock";

const dynamoMock = mockClient(DynamoDBClient);

const projectFactItem = {
  PK: "ORG#org-a#FY#2026",
  SK: "L#line-1",
  GSI4PK: "ORG#org-a#PROJECTS_ALL",
  GSI4SK: "PRJ#PRJ-1#FY#2026#DT#2026-03-01#line-1",
  entityType: "ENTRY_LINE",
  orgId: "org-a",
  year: 2026,
  entryId: "entry-1",
  lineId: "line-1",
  entryDate: "2026-03-01",
  accountId: "60100000",
  debit: 125000,
  credit: 0,
  projectId: "PRJ-1",
  donorId: "DONOR-1",
  budgetLineId: "ACT-1",
};

describe("AccountingProjectReportingService", () => {
  beforeEach(() => dynamoMock.reset());

  test("queries the Accounting-owned project/year projection and returns key-free facts", async () => {
    dynamoMock.on(QueryCommand).resolves({
      Items: [marshall(projectFactItem)],
    });

    const facts = await AccountingProjectReportingService.listProjectFacts({
      orgId: "org-a",
      projectId: "PRJ-1",
      year: "2026",
    });
    const query = dynamoMock.commandCalls(QueryCommand)[0].args[0].input;

    expect(query).toMatchObject({
      IndexName: "GSI4",
      KeyConditionExpression: "GSI4PK = :pk AND begins_with(GSI4SK, :sk)",
      ExpressionAttributeValues: {
        ":pk": { S: "ORG#org-a#PROJECTS_ALL" },
        ":sk": { S: "PRJ#PRJ-1#FY#2026" },
      },
    });
    expect(facts).toEqual([
      {
        entryId: "entry-1",
        entryLineId: "line-1",
        date: "2026-03-01",
        year: 2026,
        accountId: "60100000",
        debit: 125000,
        credit: 0,
        projectId: "PRJ-1",
        donorId: "DONOR-1",
        budgetLineId: "ACT-1",
      },
    ]);
    expect(facts[0]).not.toHaveProperty("PK");
    expect(facts[0]).not.toHaveProperty("SK");
    expect(facts[0]).not.toHaveProperty("GSI4PK");
    expect(facts[0]).not.toHaveProperty("GSI4SK");
    expect(facts[0]).not.toHaveProperty("entityType");
    expect(dynamoMock.commandCalls(ScanCommand)).toHaveLength(0);
  });

  test("excludes rows outside the requested tenant or fiscal year", async () => {
    dynamoMock.on(QueryCommand).resolves({
      Items: [
        marshall(projectFactItem),
        marshall({
          ...projectFactItem,
          PK: "ORG#org-b#FY#2026",
          GSI4PK: "ORG#org-b#PROJECTS_ALL",
          orgId: "org-b",
          lineId: "line-org-b",
        }),
        marshall({
          ...projectFactItem,
          PK: "ORG#org-a#FY#2025",
          year: 2025,
          lineId: "line-2025",
        }),
      ],
    });

    const facts = await AccountingProjectReportingService.listProjectFacts({
      orgId: "org-a",
      projectId: "PRJ-1",
      year: "2026",
    });

    expect(facts.map(({ entryLineId }) => entryLineId)).toEqual(["line-1"]);
  });

  test("lists all tenant project facts in GSI order and handles empty results", async () => {
    dynamoMock
      .on(QueryCommand)
      .resolvesOnce({
        Items: [
          marshall(projectFactItem),
          marshall({
            ...projectFactItem,
            SK: "L#line-2",
            GSI4SK: "PRJ#PRJ-2#FY#2025#DT#2025-04-01#line-2",
            year: 2025,
            lineId: "line-2",
            projectId: "PRJ-2",
          }),
        ],
      })
      .resolvesOnce({ Items: [] });

    const facts =
      await AccountingProjectReportingService.listOrganizationProjectFacts({
        orgId: "org-a",
      });
    const empty =
      await AccountingProjectReportingService.listOrganizationProjectFacts({
        orgId: "org-a",
      });
    const query = dynamoMock.commandCalls(QueryCommand)[0].args[0].input;

    expect(query).toMatchObject({
      IndexName: "GSI4",
      KeyConditionExpression: "GSI4PK = :pk",
      ExpressionAttributeValues: {
        ":pk": { S: "ORG#org-a#PROJECTS_ALL" },
      },
    });
    expect(facts.map(({ projectId }) => projectId)).toEqual(["PRJ-1", "PRJ-2"]);
    expect(empty).toEqual([]);
  });
});
