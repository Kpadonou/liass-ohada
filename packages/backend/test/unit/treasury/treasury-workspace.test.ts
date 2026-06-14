import { handler as cancelReconciliationHandler } from "@/lambda/domains/treasury/cancel-reconciliation";
import { handler as createAccountHandler } from "@/lambda/domains/treasury/create-account";
import { handler as importStatementLinesHandler } from "@/lambda/domains/treasury/import-statement-lines";
import { handler as listAccountsHandler } from "@/lambda/domains/treasury/list-accounts";
import { handler as listMovementsHandler } from "@/lambda/domains/treasury/list-movements";
import { handler as postTransactionHandler } from "@/lambda/domains/treasury/post-transaction";
import { handler as reconcileHandler } from "@/lambda/domains/treasury/reconcile";
import { LedgerService } from "@/lambda/shared/services/ledger-service";
import { TenantAccessService } from "@/lambda/shared/services/tenant-access-service";
import {
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  QueryCommand,
  ScanCommand,
  TransactWriteItemsCommand,
} from "@aws-sdk/client-dynamodb";
import { mockClient } from "aws-sdk-client-mock";

const dynamoMock = mockClient(DynamoDBClient);

jest.mock("@/lambda/shared/services/ledger-service", () => ({
  LedgerService: {
    postEntry: jest.fn(),
  },
}));

jest.mock("@/lambda/shared/services/tenant-access-service", () => ({
  TenantAccessService: {
    assertUserCanAccessOrg: jest.fn(),
  },
}));

const createEvent = (
  routeKey: string,
  body = {},
  pathParameters?: Record<string, string>,
  queryStringParameters?: Record<string, string>,
) => ({
  version: "2.0",
  routeKey,
  rawPath: routeKey.replace(/^[A-Z]+ /, ""),
  rawQueryString: "",
  headers: { "accept-language": "en", "x-org-id": "test-org" },
  requestContext: {
    authorizer: {
      jwt: {
        claims: { sub: "user-123" },
        scopes: [],
      },
    },
  },
  body: Object.keys(body).length > 0 ? JSON.stringify(body) : undefined,
  pathParameters,
  queryStringParameters,
  isBase64Encoded: false,
});

const parseResponse = (response: any) => JSON.parse(response.body ?? "{}");

const ledgerAccountItem = {
  PK: { S: "ORG#test-org" },
  SK: { S: "ACC#52100000" },
  orgId: { S: "test-org" },
  accountId: { S: "52100000" },
  accountName: { S: "Bank" },
  accountNature: { S: "BALANCE" },
  accountUsage: { S: "BOTH" },
  isThirdPartyAccount: { BOOL: false },
  classCode: { N: "5" },
  financialStatementCode: { S: "BS" },
  allowReconciliation: { BOOL: true },
  entityType: { S: "ACCOUNT" },
  createdAt: { S: "2026-01-01T00:00:00Z" },
  updatedAt: { S: "2026-01-01T00:00:00Z" },
};

const treasuryAccountItem = {
  PK: { S: "ORG#test-org" },
  SK: { S: "TRS#ACC#52100000" },
  orgId: { S: "test-org" },
  treasuryAccountId: { S: "52100000" },
  accountId: { S: "52100000" },
  label: { S: "Main bank" },
  type: { S: "BANK" },
  currency: { S: "XOF" },
  openingBalance: { N: "0" },
  active: { BOOL: true },
  entityType: { S: "TREASURY_ACCOUNT" },
  createdAt: { S: "2026-01-01T00:00:00Z" },
  updatedAt: { S: "2026-01-01T00:00:00Z" },
};

const statementLineItem = {
  PK: { S: "ORG#test-org#FY#2026" },
  SK: { S: "TRS#52100000#FY#2026#STMT#2026-01-15#stmt-1" },
  orgId: { S: "test-org" },
  treasuryAccountId: { S: "52100000" },
  statementLineId: { S: "stmt-1" },
  year: { S: "2026" },
  date: { S: "2026-01-15" },
  reference: { S: "REF-1" },
  label: { S: "Bank credit" },
  amount: { N: "1000" },
  currency: { S: "XOF" },
  status: { S: "UNMATCHED" },
  importedAt: { S: "2026-01-15T00:00:00Z" },
  entityType: { S: "BANK_STATEMENT_LINE" },
};

const entryLineItem = {
  PK: { S: "ORG#test-org#FY#2026" },
  SK: { S: "L#line-1" },
  orgId: { S: "test-org" },
  entryId: { S: "entry-1" },
  lineId: { S: "line-1" },
  entryDate: { S: "2026-01-15" },
  journalCode: { S: "BANK" },
  accountId: { S: "52100000" },
  label: { S: "Bank credit" },
  voucherNumber: { S: "REF-1" },
  debit: { N: "1000" },
  credit: { N: "0" },
  GSI1PK: { S: "ACCOUNT#test-org" },
  GSI1SK: { S: "ACC#52100000#FY#2026#2026-01-15#line-1" },
  entityType: { S: "ENTRY_LINE" },
};

describe("treasury workspace handlers", () => {
  beforeEach(() => {
    dynamoMock.reset();
    jest.clearAllMocks();
    jest
      .mocked(TenantAccessService.assertUserCanAccessOrg)
      .mockResolvedValue({ role: "ACCOUNTANT" });
  });

  test("POST /treasury/accounts validates class 5 account and returns a public DTO", async () => {
    dynamoMock.on(GetItemCommand).resolvesOnce({ Item: ledgerAccountItem });
    dynamoMock.on(PutItemCommand).resolves({});

    const response = await createAccountHandler(
      createEvent("POST /treasury/accounts", {
        accountId: "52100000",
        label: "Main bank",
        type: "BANK",
        currency: "XOF",
      }),
    );
    const body = parseResponse(response);
    const putInput = dynamoMock.commandCalls(PutItemCommand)[0].args[0].input;

    expect(response.statusCode).toBe(200);
    expect(putInput.ConditionExpression).toBe(
      "attribute_not_exists(PK) AND attribute_not_exists(SK)",
    );
    expect(putInput.Item?.SK).toEqual({ S: "TRS#ACC#52100000" });
    expect(body.data).toMatchObject({
      treasuryAccountId: "52100000",
      accountId: "52100000",
      label: "Main bank",
      type: "BANK",
    });
    expect(body.data.PK).toBeUndefined();
    expect(body.data.SK).toBeUndefined();
    expect(body.data.entityType).toBeUndefined();
  });

  test("GET /treasury/accounts queries the treasury prefix without Scan", async () => {
    dynamoMock.on(QueryCommand).resolves({ Items: [treasuryAccountItem] });

    const response = await listAccountsHandler(
      createEvent("GET /treasury/accounts"),
    );
    const body = parseResponse(response);

    expect(response.statusCode).toBe(200);
    const queryInput = dynamoMock.commandCalls(QueryCommand)[0].args[0].input;
    expect(queryInput.KeyConditionExpression).toBe(
      "PK = :pk AND begins_with(SK, :sk)",
    );
    expect(queryInput.ExpressionAttributeValues?.[":sk"]).toEqual({
      S: "TRS#ACC#",
    });
    expect(body.data.accounts[0].treasuryAccountId).toBe("52100000");
    expect(body.data.accounts[0].PK).toBeUndefined();
    expect(dynamoMock.commandCalls(ScanCommand)).toHaveLength(0);
  });

  test("GET /treasury/accounts/{id}/movements reads entry lines from GSI1", async () => {
    dynamoMock
      .on(GetItemCommand)
      .resolvesOnce({ Item: treasuryAccountItem })
      .resolvesOnce({});
    dynamoMock.on(QueryCommand).resolves({ Items: [entryLineItem] });

    const response = await listMovementsHandler(
      createEvent(
        "GET /treasury/accounts/{treasuryAccountId}/movements",
        {},
        { treasuryAccountId: "52100000" },
        { year: "2026" },
      ),
    );
    const body = parseResponse(response);

    expect(response.statusCode).toBe(200);
    const queryInput = dynamoMock.commandCalls(QueryCommand)[0].args[0].input;
    expect(queryInput.IndexName).toBe("GSI1");
    expect(queryInput.KeyConditionExpression).toBe(
      "GSI1PK = :pk AND begins_with(GSI1SK, :sk)",
    );
    expect(body.data.movements[0]).toMatchObject({
      entryId: "entry-1",
      lineId: "line-1",
      direction: "INFLOW",
      runningBalance: 1000,
    });
    expect(body.data.movements[0].PK).toBeUndefined();
    expect(dynamoMock.commandCalls(ScanCommand)).toHaveLength(0);
  });

  test("POST /treasury/transactions delegates a balanced class 5 entry to LedgerService", async () => {
    dynamoMock.on(GetItemCommand).resolvesOnce({ Item: treasuryAccountItem });
    jest
      .mocked(LedgerService.postEntry)
      .mockResolvedValue({ entryId: "entry-1" });

    const response = await postTransactionHandler(
      createEvent("POST /treasury/transactions", {
        treasuryAccountId: "52100000",
        year: 2026,
        entryDate: "2026-01-15",
        journalCode: "BANK",
        direction: "INFLOW",
        amount: 1000,
        counterpartyAccountId: "41100000",
        label: "Customer receipt",
      }),
    );
    const body = parseResponse(response);

    expect({ statusCode: response.statusCode, body }).toMatchObject({
      statusCode: 200,
    });
    expect(body.data.entryId).toBe("entry-1");
    expect(LedgerService.postEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: "test-org",
        userId: "user-123",
        data: expect.objectContaining({
          journalCode: "BANK",
          lines: [
            expect.objectContaining({
              accountId: "52100000",
              debit: 1000,
              credit: 0,
            }),
            expect.objectContaining({
              accountId: "41100000",
              debit: 0,
              credit: 1000,
            }),
          ],
        }),
      }),
    );
  });

  test("POST /treasury/accounts/{id}/statement-lines/import writes deterministic statement lines idempotently", async () => {
    dynamoMock.on(GetItemCommand).resolvesOnce({ Item: treasuryAccountItem });
    dynamoMock.on(PutItemCommand).resolves({});

    const response = await importStatementLinesHandler(
      createEvent(
        "POST /treasury/accounts/{treasuryAccountId}/statement-lines/import",
        {
          treasuryAccountId: "52100000",
          year: "2026",
          lines: [
            {
              date: "2026-01-15",
              reference: "REF-1",
              label: "Bank credit",
              amount: 1000,
              currency: "XOF",
            },
          ],
        },
        { treasuryAccountId: "52100000" },
      ),
    );
    const body = parseResponse(response);
    const putInput = dynamoMock.commandCalls(PutItemCommand)[0].args[0].input;

    expect(response.statusCode).toBe(200);
    expect(putInput.ConditionExpression).toBe(
      "attribute_not_exists(PK) AND attribute_not_exists(SK)",
    );
    expect(putInput.Item?.SK?.S).toMatch(
      /^TRS#52100000#FY#2026#STMT#2026-01-15#[a-f0-9]{24}$/,
    );
    expect(body.data.imported).toBe(1);
    expect(body.data.statementLines[0].PK).toBeUndefined();
  });

  test("POST /treasury/reconciliations creates the match and updates both sides transactionally", async () => {
    dynamoMock
      .on(GetItemCommand)
      .resolvesOnce({ Item: treasuryAccountItem })
      .resolvesOnce({ Item: entryLineItem });
    dynamoMock.on(QueryCommand).resolvesOnce({ Items: [statementLineItem] });
    dynamoMock.on(TransactWriteItemsCommand).resolves({});

    const response = await reconcileHandler(
      createEvent("POST /treasury/reconciliations", {
        treasuryAccountId: "52100000",
        year: "2026",
        statementLineId: "stmt-1",
        entryId: "entry-1",
        lineId: "line-1",
      }),
    );
    const body = parseResponse(response);

    expect(response.statusCode).toBe(200);
    const transaction =
      dynamoMock.commandCalls(TransactWriteItemsCommand)[0].args[0].input;
    expect(transaction.TransactItems).toHaveLength(3);
    expect(transaction.TransactItems?.[0].Put?.Item?.SK?.S).toMatch(
      /^TRS#52100000#FY#2026#RCN#RCN-/,
    );
    expect(transaction.TransactItems?.[1].Update?.UpdateExpression).toContain(
      "#status = :matched",
    );
    expect(transaction.TransactItems?.[2].Update?.UpdateExpression).toContain(
      "reconciliationStatus = :matched",
    );
    expect(body.data).toMatchObject({
      treasuryAccountId: "52100000",
      statementLineId: "stmt-1",
      lineId: "line-1",
      status: "ACTIVE",
    });
    expect(body.data.PK).toBeUndefined();
  });

  test("POST /treasury/reconciliations/{matchId}/cancel restores unmatched statuses transactionally", async () => {
    dynamoMock.on(GetItemCommand).resolvesOnce({
      Item: {
        PK: { S: "ORG#test-org#FY#2026" },
        SK: { S: "TRS#52100000#FY#2026#RCN#RCN-1" },
        orgId: { S: "test-org" },
        treasuryAccountId: { S: "52100000" },
        matchId: { S: "RCN-1" },
        year: { S: "2026" },
        statementLineId: { S: "stmt-1" },
        entryId: { S: "entry-1" },
        lineId: { S: "line-1" },
        amount: { N: "1000" },
        status: { S: "ACTIVE" },
        matchedAt: { S: "2026-01-15T00:00:00Z" },
        entityType: { S: "RECONCILIATION_MATCH" },
      },
    });
    dynamoMock.on(QueryCommand).resolvesOnce({ Items: [statementLineItem] });
    dynamoMock.on(TransactWriteItemsCommand).resolves({});

    const response = await cancelReconciliationHandler(
      createEvent(
        "POST /treasury/reconciliations/{matchId}/cancel",
        {
          treasuryAccountId: "52100000",
          year: "2026",
          matchId: "RCN-1",
        },
        { matchId: "RCN-1" },
      ),
    );
    const body = parseResponse(response);
    const transaction =
      dynamoMock.commandCalls(TransactWriteItemsCommand)[0].args[0].input;

    expect(response.statusCode).toBe(200);
    expect(transaction.TransactItems).toHaveLength(3);
    expect(transaction.TransactItems?.[1].Update?.UpdateExpression).toContain(
      "SET #status = :unmatched REMOVE",
    );
    expect(transaction.TransactItems?.[2].Update?.UpdateExpression).toContain(
      "reconciliationStatus = :unmatched",
    );
    expect(body.data.status).toBe("CANCELLED");
    expect(body.data.entityType).toBeUndefined();
  });
});
