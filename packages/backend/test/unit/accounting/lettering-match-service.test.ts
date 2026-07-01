import { KeyFactory } from "@/lambda/shared/key-builder";
import { LetteringService } from "@/lambda/shared/services/lettering-service";
import {
  BatchGetItemCommand,
  DynamoDBClient,
  GetItemCommand,
  QueryCommand,
  ScanCommand,
  TransactWriteItemsCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { mockClient } from "aws-sdk-client-mock";

const dynamoMock = mockClient(DynamoDBClient);
const tableName = "liass-ohada-test-accounting-table";

const fiscalYear = marshall({
  orgId: "org-a",
  year: 2026,
  fiscalYearId: "FY2026",
  startDate: "2026-01-01",
  endDate: "2026-12-31",
  status: "OPEN",
  accountingFramework: "SYSCOHADA_REVISED",
  entityType: "FISCAL_YEAR",
  PK: KeyFactory.orgKey("org-a"),
  SK: KeyFactory.fiscalYearSK(2026),
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});

const account = marshall({
  orgId: "org-a",
  accountId: "41100000",
  accountName: "Clients",
  isActive: true,
  isThirdPartyAccount: true,
  requiresThirdParty: true,
  auxiliaryType: "CUSTOMER",
  entityType: "ACCOUNT",
  PK: KeyFactory.orgKey("org-a"),
  SK: KeyFactory.accountSK("41100000"),
});

const thirdParty = marshall({
  orgId: "org-a",
  thirdPartyId: "TP-1",
  code: "CLI001",
  displayName: "Client A",
  type: "CUSTOMER",
  status: "ACTIVE",
  entityType: "THIRD_PARTY",
  PK: KeyFactory.orgKey("org-a"),
  SK: KeyFactory.thirdPartySK("CUSTOMER", "TP-1"),
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});

const line = (overrides: Record<string, unknown>) => {
  const base = {
    orgId: "org-a",
    year: 2026,
    entryId: "E-1",
    lineId: "L-1",
    postingOrdinal: 1,
    accountId: "41100000",
    accountCode: "41100000",
    accountLabel: "Clients",
    thirdPartyId: "TP-1",
    thirdPartyType: "CUSTOMER",
    thirdPartyCode: "CLI001",
    thirdPartyName: "Client A",
    debit: 1000,
    credit: 0,
    entryDate: "2026-03-15",
    journalCode: "SALES",
    voucherNumber: "INV-1",
    label: "Facture client",
    entityType: "ENTRY_LINE",
    PK: KeyFactory.partitionKey("org-a", 2026),
    SK: KeyFactory.entryLineSK("L-1"),
    GSI2PK: KeyFactory.gsi2PK("org-a", "41100000", "TP-1"),
    GSI2SK: KeyFactory.gsi2SK("2026-03-15", "L-1"),
    GSI3PK: KeyFactory.unletteredPK("org-a", "41100000", "TP-1"),
    GSI3SK: KeyFactory.letteringSK("2026-03-15", "E-1", "0001"),
    createdAt: "2026-03-15T10:00:00.000Z",
    updatedAt: "2026-03-15T10:00:00.000Z",
  };

  return marshall({ ...base, ...overrides }, { removeUndefinedValues: true });
};

const creditLine = line({
  entryId: "E-2",
  lineId: "L-2",
  postingOrdinal: 1,
  debit: 0,
  credit: 1000,
  entryDate: "2026-03-20",
  journalCode: "BANK",
  voucherNumber: "PAY-1",
  label: "Règlement client",
  SK: KeyFactory.entryLineSK("L-2"),
  GSI2SK: KeyFactory.gsi2SK("2026-03-20", "L-2"),
  GSI3SK: KeyFactory.letteringSK("2026-03-20", "E-2", "0001"),
});

function mockScopeReads() {
  dynamoMock
    .on(GetItemCommand)
    .resolvesOnce({ Item: fiscalYear })
    .resolvesOnce({ Item: account })
    .resolvesOnce({ Item: thirdParty });
}

describe("LetteringService manual match foundations", () => {
  beforeEach(() => dynamoMock.reset());

  test("candidate query uses bounded GSI3 Query without Scan or ConsistentRead", async () => {
    mockScopeReads();
    dynamoMock.on(QueryCommand).resolves({
      Items: [line({})],
      LastEvaluatedKey: {
        PK: { S: "ORG#org-a#FY#2026" },
        SK: { S: "L#L-1" },
      },
    });

    const result = await LetteringService.listCandidates("org-a", {
      fiscalYear: 2026,
      accountId: "411",
      thirdPartyId: "TP-1",
      thirdPartyType: "CUSTOMER",
      dateFrom: "2026-03-01",
      dateTo: "2026-03-31",
      limit: 20,
    });
    const query = dynamoMock.commandCalls(QueryCommand)[0].args[0].input;
    const values = unmarshall(query.ExpressionAttributeValues!);

    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]).toMatchObject({
      fiscalYear: 2026,
      accountingDate: "2026-03-15",
      remainingAmount: 1000,
      letteringStatus: "UNLETTERED",
    });
    expect(query.IndexName).toBe("GSI3");
    expect(query.KeyConditionExpression).toBe(
      "GSI3PK = :pk AND GSI3SK BETWEEN :from AND :to",
    );
    expect(values[":pk"]).toBe(KeyFactory.unletteredPK("org-a", "41100000", "TP-1"));
    expect(query.ConsistentRead).toBeUndefined();
    expect(dynamoMock.commandCalls(ScanCommand)).toHaveLength(0);
  });

  test("create match rejects mismatched debit and credit allocations", async () => {
    mockScopeReads();
    dynamoMock.on(BatchGetItemCommand).resolves({
      Responses: {
        [tableName]: [line({}), creditLine],
      },
    });

    await expect(
      LetteringService.createManualMatch("org-a", "user-1", {
        fiscalYear: 2026,
        accountId: "41100000",
        thirdPartyId: "TP-1",
        thirdPartyType: "CUSTOMER",
        allocations: [
          { entryId: "E-1", lineId: "L-1", amount: 1000 },
          { entryId: "E-2", lineId: "L-2", amount: 500 },
        ],
      }),
    ).rejects.toMatchObject({ messageCode: "ERROR_LETTERING_UNBALANCED" });
    expect(dynamoMock.commandCalls(TransactWriteItemsCommand)).toHaveLength(0);
  });

  test("create match writes an audit record and updates only lettering metadata", async () => {
    mockScopeReads();
    dynamoMock.on(BatchGetItemCommand).resolves({
      Responses: {
        [tableName]: [line({}), creditLine],
      },
    });
    dynamoMock.on(TransactWriteItemsCommand).resolves({});

    const result = await LetteringService.createManualMatch("org-a", "user-1", {
      fiscalYear: 2026,
      accountId: "41100000",
      thirdPartyId: "TP-1",
      thirdPartyType: "CUSTOMER",
      allocations: [
        { entryId: "E-1", lineId: "L-1", amount: 1000 },
        { entryId: "E-2", lineId: "L-2", amount: 1000 },
      ],
    });
    const transaction =
      dynamoMock.commandCalls(TransactWriteItemsCommand)[0].args[0].input;
    const match = unmarshall(transaction.TransactItems?.[0].Put?.Item ?? {});
    const lineUpdate = transaction.TransactItems?.[1].Update;

    expect(result).toMatchObject({
      status: "ACTIVE",
      totalDebit: 1000,
      totalCredit: 1000,
    });
    expect(match).toMatchObject({
      PK: KeyFactory.partitionKey("org-a", 2026),
      SK: KeyFactory.letteringMatchSK(result.letteringId),
      entityType: "LETTERING_MATCH",
      accountId: "41100000",
      thirdPartyId: "TP-1",
    });
    expect(lineUpdate?.UpdateExpression).toContain("letteredAmount");
    expect(lineUpdate?.UpdateExpression).toContain("remainingAmount");
    expect(lineUpdate?.UpdateExpression).toContain("REMOVE GSI3PK, GSI3SK");
    expect(lineUpdate?.UpdateExpression).not.toContain("GSI2");
    expect(lineUpdate?.UpdateExpression).not.toContain("debit");
    expect(lineUpdate?.UpdateExpression).not.toContain("credit");
    expect(lineUpdate?.UpdateExpression).not.toContain("accountId");
    expect(lineUpdate?.UpdateExpression).not.toContain("thirdPartyId");
  });

  test("create match can re-letter the same lines after a previous match was cancelled", async () => {
    const allocations = [
      { entryId: "E-1", lineId: "L-1", amount: 1000 },
      { entryId: "E-2", lineId: "L-2", amount: 1000 },
    ];
    const baseLetteringId = (LetteringService as any).buildDeterministicLetteringId({
      orgId: "org-a",
      scope: {
        accountId: "41100000",
        thirdPartyId: "TP-1",
        thirdPartyType: "CUSTOMER",
        fiscalYear: 2026,
      },
      allocations,
      note: undefined,
    });
    const cancelledMatch = marshall({
      orgId: "org-a",
      letteringId: baseLetteringId,
      fiscalYear: 2026,
      accountId: "41100000",
      accountCode: "41100000",
      thirdPartyId: "TP-1",
      thirdPartyType: "CUSTOMER",
      status: "CANCELLED",
      totalDebit: 1000,
      totalCredit: 1000,
      createdAt: "2026-03-21T10:00:00.000Z",
      createdBy: "user-1",
      cancelledAt: "2026-03-21T10:10:00.000Z",
      cancelledBy: "user-2",
      allocations: [
        {
          entryId: "E-1",
          lineId: "L-1",
          accountingDate: "2026-03-15",
          journalCode: "SALES",
          debit: 1000,
          credit: 0,
          allocatedAmount: 1000,
        },
        {
          entryId: "E-2",
          lineId: "L-2",
          accountingDate: "2026-03-20",
          journalCode: "BANK",
          debit: 0,
          credit: 1000,
          allocatedAmount: 1000,
        },
      ],
      entityType: "LETTERING_MATCH",
      PK: KeyFactory.partitionKey("org-a", 2026),
      SK: KeyFactory.letteringMatchSK(baseLetteringId),
    });
    dynamoMock
      .on(GetItemCommand)
      .resolvesOnce({ Item: fiscalYear })
      .resolvesOnce({ Item: account })
      .resolvesOnce({ Item: thirdParty })
      .resolvesOnce({ Item: cancelledMatch });
    dynamoMock.on(BatchGetItemCommand).resolves({
      Responses: {
        [tableName]: [
          line({
            letteringStatus: "UNLETTERED",
            letteredAmount: 0,
            remainingAmount: 1000,
            letteringMatchIds: [],
          }),
          line({
            entryId: "E-2",
            lineId: "L-2",
            SK: KeyFactory.entryLineSK("L-2"),
            debit: 0,
            credit: 1000,
            entryDate: "2026-03-20",
            journalCode: "BANK",
            voucherNumber: "PAY-1",
            label: "Règlement client",
            GSI2SK: KeyFactory.gsi2SK("2026-03-20", "L-2"),
            GSI3SK: KeyFactory.letteringSK("2026-03-20", "E-2", "0001"),
            letteringStatus: "UNLETTERED",
            letteredAmount: 0,
            remainingAmount: 1000,
            letteringMatchIds: [],
          }),
        ],
      },
    });
    dynamoMock
      .on(TransactWriteItemsCommand)
      .rejectsOnce(
        Object.assign(new Error("cancelled match id exists"), {
          name: "TransactionCanceledException",
        }),
      )
      .resolvesOnce({});

    const result = await LetteringService.createManualMatch("org-a", "user-3", {
      fiscalYear: 2026,
      accountId: "41100000",
      thirdPartyId: "TP-1",
      thirdPartyType: "CUSTOMER",
      allocations,
    });
    const retryTransaction =
      dynamoMock.commandCalls(TransactWriteItemsCommand)[1].args[0].input;
    const retryMatch = unmarshall(
      retryTransaction.TransactItems?.[0].Put?.Item ?? {},
    );
    const retryLineValues = unmarshall(
      retryTransaction.TransactItems?.[1].Update?.ExpressionAttributeValues ?? {},
    );

    expect(result.status).toBe("ACTIVE");
    expect(result.letteringId).toMatch(new RegExp(`^${baseLetteringId}-R`));
    expect(result.letteringId).not.toBe(baseLetteringId);
    expect(retryMatch).toMatchObject({
      letteringId: result.letteringId,
      status: "ACTIVE",
      entityType: "LETTERING_MATCH",
    });
    expect(retryLineValues[":matchIds"]).toEqual([result.letteringId]);
  });

  test("create match keeps partially lettered lines in GSI3", async () => {
    mockScopeReads();
    dynamoMock.on(BatchGetItemCommand).resolves({
      Responses: {
        [tableName]: [
          line({ debit: 1500, remainingAmount: 1500 }),
          line({
            entryId: "E-2",
            lineId: "L-2",
            SK: KeyFactory.entryLineSK("L-2"),
            debit: 0,
            credit: 1500,
            remainingAmount: 1500,
            GSI2SK: KeyFactory.gsi2SK("2026-03-20", "L-2"),
            GSI3SK: KeyFactory.letteringSK("2026-03-20", "E-2", "0001"),
          }),
        ],
      },
    });
    dynamoMock.on(TransactWriteItemsCommand).resolves({});

    await LetteringService.createManualMatch("org-a", "user-1", {
      fiscalYear: 2026,
      accountId: "41100000",
      thirdPartyId: "TP-1",
      thirdPartyType: "CUSTOMER",
      allocations: [
        { entryId: "E-1", lineId: "L-1", amount: 1000 },
        { entryId: "E-2", lineId: "L-2", amount: 1000 },
      ],
    });
    const transaction =
      dynamoMock.commandCalls(TransactWriteItemsCommand)[0].args[0].input;
    const lineUpdate = transaction.TransactItems?.[1].Update;
    const values = unmarshall(lineUpdate?.ExpressionAttributeValues ?? {});

    expect(lineUpdate?.UpdateExpression).toContain("GSI3PK = :gsi3pk");
    expect(lineUpdate?.UpdateExpression).not.toContain("REMOVE GSI3");
    expect(values[":newRemainingAmount"]).toBe(500);
    expect(values[":letteringStatus"]).toBe("PARTIAL");
  });

  test("cancel match marks the audit record and restores GSI3 eligibility", async () => {
    const matchItem = marshall({
      orgId: "org-a",
      letteringId: "LM-1",
      fiscalYear: 2026,
      accountId: "41100000",
      accountCode: "41100000",
      thirdPartyId: "TP-1",
      thirdPartyType: "CUSTOMER",
      status: "ACTIVE",
      totalDebit: 1000,
      totalCredit: 1000,
      createdAt: "2026-03-21T10:00:00.000Z",
      createdBy: "user-1",
      allocations: [
        {
          entryId: "E-1",
          lineId: "L-1",
          accountingDate: "2026-03-15",
          journalCode: "SALES",
          debit: 1000,
          credit: 0,
          allocatedAmount: 1000,
        },
      ],
      entityType: "LETTERING_MATCH",
      PK: KeyFactory.partitionKey("org-a", 2026),
      SK: KeyFactory.letteringMatchSK("LM-1"),
    });
    dynamoMock.on(GetItemCommand).resolves({ Item: matchItem });
    dynamoMock.on(BatchGetItemCommand).resolves({
      Responses: {
        [tableName]: [
          line({
            letteredAmount: 1000,
            remainingAmount: 0,
            letteringStatus: "LETTERED",
            letteringMatchIds: ["LM-1"],
            GSI3PK: undefined,
            GSI3SK: undefined,
          }),
        ],
      },
    });
    dynamoMock.on(TransactWriteItemsCommand).resolves({});

    const result = await LetteringService.cancelMatch("org-a", "user-2", {
      fiscalYear: 2026,
      letteringId: "LM-1",
      cancellationReason: "Erreur de sélection",
    });
    const transaction =
      dynamoMock.commandCalls(TransactWriteItemsCommand)[0].args[0].input;
    const matchUpdate = transaction.TransactItems?.[0].Update;
    const lineUpdate = transaction.TransactItems?.[1].Update;

    expect(result.status).toBe("CANCELLED");
    expect(matchUpdate?.UpdateExpression).toContain("#status = :cancelled");
    expect(lineUpdate?.UpdateExpression).toContain("GSI3PK = :gsi3pk");
    expect(lineUpdate?.UpdateExpression).toContain("remainingAmount");
    expect(lineUpdate?.UpdateExpression).not.toContain("GSI2");
    expect(lineUpdate?.UpdateExpression).not.toContain("debit");
    expect(lineUpdate?.UpdateExpression).not.toContain("credit");
  });
});
