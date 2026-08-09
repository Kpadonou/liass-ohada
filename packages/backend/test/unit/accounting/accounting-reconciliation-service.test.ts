import { AccountingReconciliationService } from "@/lambda/domains/accounting/reconciliation/accounting-reconciliation-service";
import {
  DynamoDBClient,
  GetItemCommand,
  QueryCommand,
  ScanCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall } from "@aws-sdk/util-dynamodb";
import { mockClient } from "aws-sdk-client-mock";

const dynamoMock = mockClient(DynamoDBClient);

const entryLine = {
  PK: "ORG#org-a#FY#2026",
  SK: "L#line-1",
  entityType: "ENTRY_LINE",
  orgId: "org-a",
  entryId: "entry-1",
  lineId: "line-1",
  entryDate: "2026-01-15",
  journalCode: "BANK",
  accountId: "52100000",
  label: "Bank credit",
  voucherNumber: "REF-1",
  debit: 1000,
  credit: 0,
  GSI1PK: "ACCOUNT#org-a",
  GSI1SK: "ACC#52100000#FY#2026#2026-01-15#line-1",
};

describe("AccountingReconciliationService", () => {
  beforeEach(() => dynamoMock.reset());

  test("returns a purpose-built candidate read model without persistence metadata", async () => {
    dynamoMock.on(GetItemCommand).resolves({});
    dynamoMock.on(QueryCommand).resolves({ Items: [marshall(entryLine)] });

    const result =
      await AccountingReconciliationService.listReconciliationCandidates({
        orgId: "org-a",
        year: "2026",
        accountId: "52100000",
      });
    const query = dynamoMock.commandCalls(QueryCommand)[0].args[0].input;

    expect(query).toMatchObject({
      IndexName: "GSI1",
      KeyConditionExpression: "GSI1PK = :pk AND begins_with(GSI1SK, :sk)",
      ExpressionAttributeValues: {
        ":pk": { S: "ORG#org-a" },
        ":sk": { S: "ACC#52100000#FY#2026" },
      },
    });
    expect(result).toEqual({
      openingBalance: 0,
      lines: [
        {
          accountId: "52100000",
          credit: 0,
          date: "2026-01-15",
          debit: 1000,
          entryId: "entry-1",
          entryLineId: "line-1",
          journalCode: "BANK",
          label: "Bank credit",
          reconciliationStatus: "UNMATCHED",
          reference: "REF-1",
        },
      ],
    });
    expect(result.lines[0]).not.toHaveProperty("PK");
    expect(result.lines[0]).not.toHaveProperty("SK");
    expect(result.lines[0]).not.toHaveProperty("entityType");
    expect(dynamoMock.commandCalls(ScanCommand)).toHaveLength(0);
  });

  test("loads and validates one Accounting entry line in the requested tenant", async () => {
    dynamoMock.on(GetItemCommand).resolves({ Item: marshall(entryLine) });

    const result = await AccountingReconciliationService.getReconciliationLine({
      orgId: "org-a",
      year: "2026",
      entryLineId: "line-1",
      expectedEntryId: "entry-1",
    });
    const get = dynamoMock.commandCalls(GetItemCommand)[0].args[0].input;

    expect(get.Key).toEqual({
      PK: { S: "ORG#org-a#FY#2026" },
      SK: { S: "L#line-1" },
    });
    expect(result).toMatchObject({
      accountId: "52100000",
      entryId: "entry-1",
      entryLineId: "line-1",
    });
    expect(result).not.toHaveProperty("PK");
  });

  test("rejects an entry line returned from another organization", async () => {
    dynamoMock.on(GetItemCommand).resolves({
      Item: marshall({
        ...entryLine,
        PK: "ORG#org-b#FY#2026",
        orgId: "org-b",
      }),
    });

    await expect(
      AccountingReconciliationService.getReconciliationLine({
        orgId: "org-a",
        year: "2026",
        entryLineId: "line-1",
      }),
    ).rejects.toMatchObject({
      statusCode: 404,
      messageCode: "ERROR_ACCOUNTING_MOVEMENT_NOT_FOUND",
    });
  });

  test("rejects a supplied entry that does not own the selected line", async () => {
    dynamoMock.on(GetItemCommand).resolves({ Item: marshall(entryLine) });

    await expect(
      AccountingReconciliationService.getReconciliationLine({
        orgId: "org-a",
        year: "2026",
        entryLineId: "line-1",
        expectedEntryId: "entry-other",
      }),
    ).rejects.toMatchObject({
      statusCode: 409,
      messageCode: "ERROR_RECONCILIATION_ENTRY_OWNERSHIP_MISMATCH",
    });
  });

  test("keeps the already-reconciled invariant in Accounting Core", async () => {
    dynamoMock.on(GetItemCommand).resolves({
      Item: marshall({
        ...entryLine,
        reconciliationMatchId: "RCN-existing",
        reconciliationStatus: "MATCHED",
      }),
    });

    await expect(
      AccountingReconciliationService.getReconciliationLine({
        orgId: "org-a",
        year: "2026",
        entryLineId: "line-1",
      }),
    ).rejects.toMatchObject({
      statusCode: 400,
      messageCode: "ERROR_ACCOUNTING_MOVEMENT_ALREADY_RECONCILED",
    });
  });

  test("prepares the Accounting-owned apply operation with unchanged conditions", () => {
    const operation =
      AccountingReconciliationService.buildApplyReconciliationOperation({
        orgId: "org-a",
        year: "2026",
        entryLineId: "line-1",
        statementLineId: "stmt-1",
        statementDate: "2026-01-15",
        reconciliationMatchId: "RCN-1",
        reconciledAt: "2026-01-15T12:00:00.000Z",
      });

    expect(operation).toMatchObject({
      owner: "ACCOUNTING_CORE",
      purpose: "APPLY_RECONCILIATION",
      transactWriteItem: {
        Update: {
          Key: {
            PK: { S: "ORG#org-a#FY#2026" },
            SK: { S: "L#line-1" },
          },
          ConditionExpression:
            "attribute_exists(PK) AND attribute_exists(SK) AND attribute_not_exists(reconciliationMatchId)",
        },
      },
    });
  });

  test("prepares cancellation that changes only reconciliation metadata", () => {
    const operation =
      AccountingReconciliationService.buildCancelReconciliationOperation({
        orgId: "org-a",
        year: "2026",
        entryLineId: "line-1",
        reconciliationMatchId: "RCN-1",
      });
    const update = operation.transactWriteItem.Update;

    expect(operation.purpose).toBe("CANCEL_RECONCILIATION");
    expect(update?.Key).toEqual({
      PK: { S: "ORG#org-a#FY#2026" },
      SK: { S: "L#line-1" },
    });
    expect(update?.UpdateExpression).toBe(
      "SET reconciliationStatus = :unmatched REMOVE statementLineId, statementDate, reconciledAt, reconciliationMatchId",
    );
    expect(update?.ConditionExpression).toBe(
      "attribute_exists(PK) AND attribute_exists(SK) AND reconciliationMatchId = :expectedMatchId",
    );
    expect(update?.ExpressionAttributeValues).toMatchObject({
      ":unmatched": { S: "UNMATCHED" },
      ":expectedMatchId": { S: "RCN-1" },
    });
    expect(update?.UpdateExpression).not.toMatch(/debit|credit|accountId|entryId/);
  });
});
