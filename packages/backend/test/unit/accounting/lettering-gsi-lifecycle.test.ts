import { LetteringService } from "@/lambda/shared/services/lettering-service";
import {
  BatchGetItemCommand,
  DynamoDBClient,
  GetItemCommand,
  TransactWriteItemsCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall } from "@aws-sdk/util-dynamodb";
import { mockClient } from "aws-sdk-client-mock";

const dynamoMock = mockClient(DynamoDBClient);
const tableName = "liass-ohada-test-accounting-table";

const line = (
  entryId: string,
  lineId: string,
  postingOrdinal: number,
  debit: number,
  credit: number,
) =>
  marshall({
    orgId: "org-a",
    year: 2026,
    entryId,
    lineId,
    postingOrdinal,
    accountId: "41100000",
    thirdPartyId: "TP-1",
    thirdPartyType: "CUSTOMER",
    debit,
    credit,
    entryDate: "2026-04-05",
    journalCode: "SALES",
    entityType: "ENTRY_LINE",
    PK: "ORG#org-a#FY#2026",
    SK: `L#${lineId}`,
    GSI2PK: "ORG#org-a#ACC#41100000#TP#TP-1",
    GSI2SK: `DT#2026-04-05#${lineId}`,
    GSI3PK: "ORG#org-a#ACC#41100000#TP#TP-1",
    GSI3SK: `UNLETTERED#2026-04-05#${entryId}#${postingOrdinal
      .toString()
      .padStart(4, "0")}`,
    createdAt: "2026-04-05T00:00:00.000Z",
    updatedAt: "2026-04-05T00:00:00.000Z",
  });

function mockReads(secondCredit: number) {
  dynamoMock
    .on(GetItemCommand)
    .resolvesOnce({ Item: undefined })
    .resolvesOnce({
      Item: marshall({
        PK: "ORG#org-a",
        SK: "ORG#METADATA",
        entityType: "ORGANIZATION",
        orgId: "org-a",
        accountingFramework: "SYSCOHADA_REVISED",
      }),
    })
    .resolvesOnce({ Item: undefined });
  dynamoMock.on(BatchGetItemCommand).resolves({
    Responses: {
      [tableName]: [
        line("E-1", "L-1", 1, 100, 0),
        line("E-2", "L-2", 1, 0, secondCredit),
      ],
    },
  });
  dynamoMock.on(TransactWriteItemsCommand).resolves({});
}

const params = {
  accountId: "41100000",
  thirdPartyId: "TP-1",
  letteringCode: "A1",
  lines: [
    { year: 2026, entryId: "E-1", lineId: "L-1" },
    { year: 2026, entryId: "E-2", lineId: "L-2" },
  ],
};

describe("GSI3 lettering lifecycle", () => {
  beforeEach(() => dynamoMock.reset());

  test("full lettering removes only GSI3 eligibility", async () => {
    mockReads(100);

    await LetteringService.postLettering("org-a", "user-1", params);
    const updates =
      dynamoMock.commandCalls(TransactWriteItemsCommand)[0].args[0].input
        .TransactItems ?? [];

    expect(updates).toHaveLength(2);
    for (const item of updates) {
      expect(item.Update?.UpdateExpression).toContain("REMOVE GSI3PK, GSI3SK");
      expect(item.Update?.UpdateExpression).not.toContain("GSI2");
    }
  });

  test("partial lettering leaves the line discoverable in GSI3", async () => {
    mockReads(50);

    await LetteringService.postLettering("org-a", "user-1", params);
    const updates =
      dynamoMock.commandCalls(TransactWriteItemsCommand)[0].args[0].input
        .TransactItems ?? [];

    for (const item of updates) {
      expect(item.Update?.UpdateExpression).not.toContain("REMOVE GSI3");
      expect(item.Update?.UpdateExpression).not.toContain("GSI2");
    }
  });
});
