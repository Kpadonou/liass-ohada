import { handler as cancelReconciliationHandler } from "@/lambda/domains/treasury/cancel-reconciliation";
import { handler as createAccountHandler } from "@/lambda/domains/treasury/create-account";
import { handler as importStatementLinesHandler } from "@/lambda/domains/treasury/import-statement-lines";
import { handler as listAccountsHandler } from "@/lambda/domains/treasury/list-accounts";
import { handler as listMovementsHandler } from "@/lambda/domains/treasury/list-movements";
import { handler as listReconciliationsHandler } from "@/lambda/domains/treasury/list-reconciliations";
import { handler as listStatementLinesHandler } from "@/lambda/domains/treasury/list-statement-lines";
import { handler as postTransactionHandler } from "@/lambda/domains/treasury/post-transaction";
import { handler as reconcileHandler } from "@/lambda/domains/treasury/reconcile";
import { LedgerService } from "@/lambda/shared/services/ledger-service";
import { TenantAccessService } from "@/lambda/shared/services/tenant-access-service";
import { TreasuryService } from "@/lambda/shared/services/treasury-service";
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
  isActive: { BOOL: true },
  entityType: { S: "ACCOUNT" },
  createdAt: { S: "2026-01-01T00:00:00Z" },
  updatedAt: { S: "2026-01-01T00:00:00Z" },
};

const nonTreasuryLedgerAccountItem = {
  ...ledgerAccountItem,
  SK: { S: "ACC#41100000" },
  accountId: { S: "41100000" },
  accountName: { S: "Customer" },
  classCode: { N: "4" },
};

const inactiveLedgerAccountItem = {
  ...ledgerAccountItem,
  isActive: { BOOL: false },
};

const otherOrgLedgerAccountItem = {
  ...ledgerAccountItem,
  PK: { S: "ORG#other-org" },
  orgId: { S: "other-org" },
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
  statementDate: { S: "2026-01-15" },
  date: { S: "2026-01-15" },
  reference: { S: "REF-1" },
  externalId: { S: "EXT-1" },
  description: { S: "Bank credit" },
  label: { S: "Bank credit" },
  amount: { N: "1000" },
  direction: { S: "INFLOW" },
  currency: { S: "XOF" },
  status: { S: "UNMATCHED" },
  importedAt: { S: "2026-01-15T00:00:00Z" },
  entityType: { S: "BANK_STATEMENT_LINE" },
};

const matchedOutflowStatementLineItem = {
  ...statementLineItem,
  SK: { S: "TRS#52100000#FY#2026#STMT#2026-01-16#stmt-2" },
  statementLineId: { S: "stmt-2" },
  statementDate: { S: "2026-01-16" },
  date: { S: "2026-01-16" },
  reference: { S: "REF-2" },
  externalId: { S: "EXT-2" },
  description: { S: "Bank fee" },
  label: { S: "Bank fee" },
  amount: { N: "250" },
  direction: { S: "OUTFLOW" },
  status: { S: "MATCHED" },
};

const outflowStatementLineItem = {
  ...matchedOutflowStatementLineItem,
  status: { S: "UNMATCHED" },
};

const otherTreasuryStatementLineItem = {
  ...statementLineItem,
  SK: { S: "TRS#53100000#FY#2026#STMT#2026-01-15#stmt-1" },
  treasuryAccountId: { S: "53100000" },
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

const creditEntryLineItem = {
  ...entryLineItem,
  SK: { S: "L#line-2" },
  lineId: { S: "line-2" },
  debit: { N: "0" },
  credit: { N: "1000" },
};

const outflowCreditEntryLineItem = {
  ...entryLineItem,
  SK: { S: "L#line-3" },
  lineId: { S: "line-3" },
  entryId: { S: "entry-2" },
  entryDate: { S: "2026-01-16" },
  label: { S: "Bank fee" },
  voucherNumber: { S: "REF-2" },
  debit: { N: "0" },
  credit: { N: "250" },
};

const debitOutflowMismatchEntryLineItem = {
  ...outflowCreditEntryLineItem,
  debit: { N: "250" },
  credit: { N: "0" },
};

const amountMismatchEntryLineItem = {
  ...entryLineItem,
  debit: { N: "999" },
};

const otherAccountEntryLineItem = {
  ...entryLineItem,
  accountId: { S: "53100000" },
};

const otherOrgEntryLineItem = {
  ...entryLineItem,
  PK: { S: "ORG#other-org#FY#2026" },
  orgId: { S: "other-org" },
};

const otherYearEntryLineItem = {
  ...entryLineItem,
  PK: { S: "ORG#test-org#FY#2025" },
  year: { S: "2025" },
};

const reconciledEntryLineItem = {
  ...entryLineItem,
  reconciliationStatus: { S: "MATCHED" },
  reconciliationMatchId: { S: "RCN-existing" },
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

  test("POST /treasury/accounts rejects non-class-5 linked accounts", async () => {
    dynamoMock
      .on(GetItemCommand)
      .resolvesOnce({ Item: nonTreasuryLedgerAccountItem });

    const response = await createAccountHandler(
      createEvent("POST /treasury/accounts", {
        accountId: "41100000",
        label: "Customer account",
        type: "BANK",
        currency: "XOF",
      }),
    );
    const body = parseResponse(response);

    expect(response.statusCode).toBe(400);
    expect(body.message).toMatchObject({
      code: "ERROR_ACCOUNT_NOT_TREASURY_CLASS",
      message:
        "A treasury account must be linked to an active SYSCOHADA class 5 account.",
    });
    expect(dynamoMock.commandCalls(PutItemCommand)).toHaveLength(0);
  });

  test("POST /treasury/accounts rejects inactive linked accounts", async () => {
    dynamoMock.on(GetItemCommand).resolvesOnce({
      Item: inactiveLedgerAccountItem,
    });

    const response = await createAccountHandler(
      createEvent("POST /treasury/accounts", {
        accountId: "52100000",
        label: "Inactive bank",
        type: "BANK",
        currency: "XOF",
      }),
    );
    const body = parseResponse(response);

    expect(response.statusCode).toBe(400);
    expect(body.message).toMatchObject({
      code: "ERROR_ACCOUNT_NOT_ACTIVE",
      message: "The linked accounting account is inactive.",
    });
    expect(dynamoMock.commandCalls(PutItemCommand)).toHaveLength(0);
  });

  test("POST /treasury/accounts rejects linked accounts from another org", async () => {
    dynamoMock.on(GetItemCommand).resolvesOnce({
      Item: otherOrgLedgerAccountItem,
    });

    const response = await createAccountHandler(
      createEvent("POST /treasury/accounts", {
        accountId: "52100000",
        label: "Other org bank",
        type: "BANK",
        currency: "XOF",
      }),
    );
    const body = parseResponse(response);

    expect(response.statusCode).toBe(404);
    expect(body.message).toMatchObject({
      code: "ERROR_ACCOUNT_NOT_FOUND",
      message: "Account not found.",
    });
    expect(dynamoMock.commandCalls(PutItemCommand)).toHaveLength(0);
  });

  test("POST /treasury/accounts rejects missing linked accounts", async () => {
    dynamoMock.on(GetItemCommand).resolvesOnce({});

    const response = await createAccountHandler(
      createEvent("POST /treasury/accounts", {
        accountId: "52100000",
        label: "Missing bank",
        type: "BANK",
        currency: "XOF",
      }),
    );
    const body = parseResponse(response);

    expect(response.statusCode).toBe(404);
    expect(body.message).toMatchObject({
      code: "ERROR_ACCOUNT_NOT_FOUND",
      message: "Account not found.",
    });
    expect(dynamoMock.commandCalls(PutItemCommand)).toHaveLength(0);
  });

  test("POST /treasury/accounts prevents duplicates for the same linked account", async () => {
    dynamoMock.on(GetItemCommand).resolvesOnce({ Item: ledgerAccountItem });
    dynamoMock.on(PutItemCommand).rejects({
      name: "ConditionalCheckFailedException",
    });

    const response = await createAccountHandler(
      createEvent("POST /treasury/accounts", {
        accountId: "52100000",
        label: "Main bank",
        type: "BANK",
        currency: "XOF",
      }),
    );
    const body = parseResponse(response);

    expect(response.statusCode).toBe(400);
    expect(body.message).toMatchObject({
      code: "ERROR_TREASURY_ACCOUNT_ALREADY_EXISTS",
      message: "This treasury account already exists.",
    });
  });

  test("GET /treasury/accounts queries the current org treasury prefix without Scan", async () => {
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
    expect(queryInput.ExpressionAttributeValues?.[":pk"]).toEqual({
      S: "ORG#test-org",
    });
    expect(queryInput.ExpressionAttributeValues?.[":sk"]).toEqual({
      S: "TRS#ACC#",
    });
    expect(body.data.accounts[0].treasuryAccountId).toBe("52100000");
    expect(body.data.count).toBe(1);
    expect(body.data.hasMore).toBe(false);
    expect(body.data.accounts[0].PK).toBeUndefined();
    expect(dynamoMock.commandCalls(ScanCommand)).toHaveLength(0);
  });

  test("GET /treasury/accounts supports cursor pagination", async () => {
    dynamoMock.on(QueryCommand).resolves({
      Items: [treasuryAccountItem],
      LastEvaluatedKey: {
        PK: { S: "ORG#test-org" },
        SK: { S: "TRS#ACC#52100000" },
      },
    });

    const response = await listAccountsHandler(
      createEvent("GET /treasury/accounts", {}, undefined, { limit: "1" }),
    );
    const body = parseResponse(response);
    const queryInput = dynamoMock.commandCalls(QueryCommand)[0].args[0].input;

    expect(response.statusCode).toBe(200);
    expect(queryInput.Limit).toBe(1);
    expect(body.data.accounts).toHaveLength(1);
    expect(body.data.count).toBe(1);
    expect(body.data.hasMore).toBe(true);
    expect(body.data.nextCursor).toEqual(expect.any(String));
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
              statementDate: "2026-01-15",
              reference: "REF-1",
              externalId: "EXT-1",
              description: "Bank credit",
              amount: 1000,
              direction: "INFLOW",
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
    expect(body.data.skipped).toBe(0);
    expect(body.data.rejected).toBe(0);
    expect(body.data.statementLines[0]).toMatchObject({
      treasuryAccountId: "52100000",
      year: "2026",
      statementDate: "2026-01-15",
      date: "2026-01-15",
      description: "Bank credit",
      label: "Bank credit",
      amount: 1000,
      direction: "INFLOW",
      status: "UNMATCHED",
    });
    expect(body.data.statementLines[0].PK).toBeUndefined();
  });

  test("POST /treasury/accounts/{id}/statement-lines/import rejects non-positive amounts", async () => {
    const response = await importStatementLinesHandler(
      createEvent(
        "POST /treasury/accounts/{treasuryAccountId}/statement-lines/import",
        {
          treasuryAccountId: "52100000",
          year: "2026",
          lines: [
            {
              statementDate: "2026-01-15",
              description: "Invalid amount",
              amount: -1000,
              direction: "INFLOW",
              currency: "XOF",
            },
          ],
        },
        { treasuryAccountId: "52100000" },
      ),
    );

    expect(response.statusCode).toBe(400);
    expect(dynamoMock.commandCalls(PutItemCommand)).toHaveLength(0);
  });

  test("POST /treasury/accounts/{id}/statement-lines/import requires a valid direction", async () => {
    const response = await importStatementLinesHandler(
      createEvent(
        "POST /treasury/accounts/{treasuryAccountId}/statement-lines/import",
        {
          treasuryAccountId: "52100000",
          year: "2026",
          lines: [
            {
              statementDate: "2026-01-15",
              description: "Missing direction",
              amount: 1000,
              currency: "XOF",
            },
          ],
        },
        { treasuryAccountId: "52100000" },
      ),
    );

    expect(response.statusCode).toBe(400);
    expect(dynamoMock.commandCalls(PutItemCommand)).toHaveLength(0);
  });

  test("POST /treasury/accounts/{id}/statement-lines/import rejects invalid dates", async () => {
    const response = await importStatementLinesHandler(
      createEvent(
        "POST /treasury/accounts/{treasuryAccountId}/statement-lines/import",
        {
          treasuryAccountId: "52100000",
          year: "2026",
          lines: [
            {
              statementDate: "15/01/2026",
              description: "Invalid date",
              amount: 1000,
              direction: "INFLOW",
              currency: "XOF",
            },
          ],
        },
        { treasuryAccountId: "52100000" },
      ),
    );

    expect(response.statusCode).toBe(400);
    expect(dynamoMock.commandCalls(PutItemCommand)).toHaveLength(0);
  });

  test("POST /treasury/accounts/{id}/statement-lines/import rejects missing treasury accounts", async () => {
    dynamoMock.on(GetItemCommand).resolvesOnce({});

    const response = await importStatementLinesHandler(
      createEvent(
        "POST /treasury/accounts/{treasuryAccountId}/statement-lines/import",
        {
          treasuryAccountId: "52100000",
          year: "2026",
          lines: [
            {
              statementDate: "2026-01-15",
              description: "Bank credit",
              amount: 1000,
              direction: "INFLOW",
              currency: "XOF",
            },
          ],
        },
        { treasuryAccountId: "52100000" },
      ),
    );
    const body = parseResponse(response);

    expect(response.statusCode).toBe(404);
    expect(body.message).toMatchObject({
      code: "ERROR_TREASURY_ACCOUNT_NOT_FOUND",
    });
    expect(dynamoMock.commandCalls(PutItemCommand)).toHaveLength(0);
  });

  test("POST /treasury/accounts/{id}/statement-lines/import rejects inactive treasury accounts", async () => {
    dynamoMock.on(GetItemCommand).resolvesOnce({
      Item: {
        ...treasuryAccountItem,
        active: { BOOL: false },
      },
    });

    const response = await importStatementLinesHandler(
      createEvent(
        "POST /treasury/accounts/{treasuryAccountId}/statement-lines/import",
        {
          treasuryAccountId: "52100000",
          year: "2026",
          lines: [
            {
              statementDate: "2026-01-15",
              description: "Bank credit",
              amount: 1000,
              direction: "INFLOW",
              currency: "XOF",
            },
          ],
        },
        { treasuryAccountId: "52100000" },
      ),
    );
    const body = parseResponse(response);

    expect(response.statusCode).toBe(400);
    expect(body.message).toMatchObject({
      code: "ERROR_TREASURY_ACCOUNT_INACTIVE",
    });
    expect(dynamoMock.commandCalls(PutItemCommand)).toHaveLength(0);
  });

  test("POST /treasury/accounts/{id}/statement-lines/import skips duplicate fingerprints", async () => {
    dynamoMock.on(GetItemCommand).resolvesOnce({ Item: treasuryAccountItem });
    dynamoMock.on(PutItemCommand).rejects({
      name: "ConditionalCheckFailedException",
    });

    const response = await importStatementLinesHandler(
      createEvent(
        "POST /treasury/accounts/{treasuryAccountId}/statement-lines/import",
        {
          treasuryAccountId: "52100000",
          year: "2026",
          lines: [
            {
              statementDate: "2026-01-15",
              reference: "REF-1",
              externalId: "EXT-1",
              description: "Bank credit",
              amount: 1000,
              direction: "INFLOW",
              currency: "XOF",
            },
          ],
        },
        { treasuryAccountId: "52100000" },
      ),
    );
    const body = parseResponse(response);

    expect(response.statusCode).toBe(200);
    expect(body.data.imported).toBe(0);
    expect(body.data.skipped).toBe(1);
    expect(body.data.statementLines).toEqual([]);
  });

  test("GET /treasury/accounts/{id}/statement-lines lists current org account and filters safely", async () => {
    dynamoMock.on(GetItemCommand).resolvesOnce({ Item: treasuryAccountItem });
    dynamoMock.on(QueryCommand).resolvesOnce({
      Items: [statementLineItem, matchedOutflowStatementLineItem],
    });

    const response = await listStatementLinesHandler(
      createEvent(
        "GET /treasury/accounts/{treasuryAccountId}/statement-lines",
        {},
        { treasuryAccountId: "52100000" },
        {
          year: "2026",
          status: "UNMATCHED",
          direction: "INFLOW",
          startDate: "2026-01-01",
          endDate: "2026-01-31",
        },
      ),
    );
    const body = parseResponse(response);
    const queryInput = dynamoMock.commandCalls(QueryCommand)[0].args[0].input;

    expect(response.statusCode).toBe(200);
    expect(queryInput.KeyConditionExpression).toBe(
      "PK = :pk AND SK BETWEEN :startSk AND :endSk",
    );
    expect(queryInput.ExpressionAttributeValues?.[":pk"]).toEqual({
      S: "ORG#test-org#FY#2026",
    });
    expect(queryInput.ExpressionAttributeValues?.[":startSk"]).toEqual({
      S: "TRS#52100000#FY#2026#STMT#2026-01-01",
    });
    expect(queryInput.ExpressionAttributeValues?.[":endSk"]).toEqual({
      S: "TRS#52100000#FY#2026#STMT#2026-01-31#~",
    });
    expect(body.data.statementLines).toHaveLength(1);
    expect(body.data.statementLines[0]).toMatchObject({
      treasuryAccountId: "52100000",
      year: "2026",
      statementDate: "2026-01-15",
      direction: "INFLOW",
      status: "UNMATCHED",
    });
    expect(body.data.count).toBe(1);
    expect(dynamoMock.commandCalls(ScanCommand)).toHaveLength(0);
  });

  test("GET /treasury/accounts/{id}/statement-lines supports pagination", async () => {
    dynamoMock.on(GetItemCommand).resolvesOnce({ Item: treasuryAccountItem });
    dynamoMock.on(QueryCommand).resolvesOnce({
      Items: [statementLineItem],
      LastEvaluatedKey: {
        PK: { S: "ORG#test-org#FY#2026" },
        SK: { S: "TRS#52100000#FY#2026#STMT#2026-01-15#stmt-1" },
      },
    });

    const response = await listStatementLinesHandler(
      createEvent(
        "GET /treasury/accounts/{treasuryAccountId}/statement-lines",
        {},
        { treasuryAccountId: "52100000" },
        { year: "2026", limit: "1" },
      ),
    );
    const body = parseResponse(response);
    const queryInput = dynamoMock.commandCalls(QueryCommand)[0].args[0].input;

    expect(response.statusCode).toBe(200);
    expect(queryInput.Limit).toBe(1);
    expect(body.data.statementLines).toHaveLength(1);
    expect(body.data.hasMore).toBe(true);
    expect(body.data.nextCursor).toEqual(expect.any(String));
    expect(dynamoMock.commandCalls(ScanCommand)).toHaveLength(0);
  });

  test("TreasuryService.getStatementLineByDate reads an exact statement-line key", async () => {
    dynamoMock
      .on(GetItemCommand)
      .resolvesOnce({ Item: treasuryAccountItem })
      .resolvesOnce({ Item: statementLineItem });

    const line = await TreasuryService.getStatementLineByDate(
      "test-org",
      "52100000",
      "2026",
      "2026-01-15",
      "stmt-1",
    );
    const exactLookup = dynamoMock.commandCalls(GetItemCommand)[1].args[0].input;

    expect(exactLookup.Key).toEqual({
      PK: { S: "ORG#test-org#FY#2026" },
      SK: { S: "TRS#52100000#FY#2026#STMT#2026-01-15#stmt-1" },
    });
    expect(line.statementLineId).toBe("stmt-1");
    expect(line.direction).toBe("INFLOW");
  });

  const setupReconciliationMocks = (
    statementItem = statementLineItem,
    movementItem = entryLineItem,
  ) => {
    dynamoMock
      .on(GetItemCommand)
      .resolvesOnce({ Item: treasuryAccountItem })
      .resolvesOnce({ Item: ledgerAccountItem })
      .resolvesOnce({ Item: statementItem })
      .resolvesOnce({ Item: movementItem });
    dynamoMock.on(TransactWriteItemsCommand).resolves({});
  };

  test("POST /treasury/reconciliations matches INFLOW with a same-amount debit movement transactionally", async () => {
    setupReconciliationMocks();

    const response = await reconcileHandler(
      createEvent("POST /treasury/reconciliations", {
        treasuryAccountId: "52100000",
        year: "2026",
        statementLineId: "stmt-1",
        statementDate: "2026-01-15",
        movementLineId: "line-1",
      }),
    );
    const body = parseResponse(response);

    expect(response.statusCode).toBe(200);
    expect(dynamoMock.commandCalls(QueryCommand)).toHaveLength(0);
    expect(dynamoMock.commandCalls(ScanCommand)).toHaveLength(0);
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
      statementDate: "2026-01-15",
      movementLineId: "line-1",
      direction: "INFLOW",
      status: "ACTIVE",
    });
    expect(body.data.PK).toBeUndefined();
  });

  test("POST /treasury/reconciliations matches OUTFLOW with a same-amount credit movement", async () => {
    setupReconciliationMocks(outflowStatementLineItem, outflowCreditEntryLineItem);

    const response = await reconcileHandler(
      createEvent("POST /treasury/reconciliations", {
        treasuryAccountId: "52100000",
        year: "2026",
        statementLineId: "stmt-2",
        statementDate: "2026-01-16",
        movementLineId: "line-3",
      }),
    );
    const body = parseResponse(response);

    expect(response.statusCode).toBe(200);
    expect(body.data).toMatchObject({
      statementLineId: "stmt-2",
      movementLineId: "line-3",
      amount: 250,
      direction: "OUTFLOW",
    });
  });

  test("POST /treasury/reconciliations rejects INFLOW matched to a credit movement", async () => {
    setupReconciliationMocks(statementLineItem, creditEntryLineItem);

    const response = await reconcileHandler(
      createEvent("POST /treasury/reconciliations", {
        treasuryAccountId: "52100000",
        year: "2026",
        statementLineId: "stmt-1",
        statementDate: "2026-01-15",
        movementLineId: "line-2",
      }),
    );
    const body = parseResponse(response);

    expect(response.statusCode).toBe(400);
    expect(body.message.code).toBe("ERROR_RECONCILIATION_DIRECTION_MISMATCH");
    expect(dynamoMock.commandCalls(TransactWriteItemsCommand)).toHaveLength(0);
  });

  test("POST /treasury/reconciliations rejects OUTFLOW matched to a debit movement", async () => {
    setupReconciliationMocks(
      outflowStatementLineItem,
      debitOutflowMismatchEntryLineItem,
    );

    const response = await reconcileHandler(
      createEvent("POST /treasury/reconciliations", {
        treasuryAccountId: "52100000",
        year: "2026",
        statementLineId: "stmt-2",
        statementDate: "2026-01-16",
        movementLineId: "line-3",
      }),
    );
    const body = parseResponse(response);

    expect(response.statusCode).toBe(400);
    expect(body.message.code).toBe("ERROR_RECONCILIATION_DIRECTION_MISMATCH");
  });

  test("POST /treasury/reconciliations rejects amount mismatches", async () => {
    setupReconciliationMocks(statementLineItem, amountMismatchEntryLineItem);

    const response = await reconcileHandler(
      createEvent("POST /treasury/reconciliations", {
        treasuryAccountId: "52100000",
        year: "2026",
        statementLineId: "stmt-1",
        statementDate: "2026-01-15",
        movementLineId: "line-1",
      }),
    );
    const body = parseResponse(response);

    expect(response.statusCode).toBe(400);
    expect(body.message.code).toBe("ERROR_RECONCILIATION_AMOUNT_MISMATCH");
  });

  test("POST /treasury/reconciliations rejects movement lines on another account", async () => {
    setupReconciliationMocks(statementLineItem, otherAccountEntryLineItem);

    const response = await reconcileHandler(
      createEvent("POST /treasury/reconciliations", {
        treasuryAccountId: "52100000",
        year: "2026",
        statementLineId: "stmt-1",
        statementDate: "2026-01-15",
        movementLineId: "line-1",
      }),
    );
    const body = parseResponse(response);

    expect(response.statusCode).toBe(400);
    expect(body.message.code).toBe("ERROR_RECONCILIATION_ACCOUNT_MISMATCH");
  });

  test("POST /treasury/reconciliations rejects movement lines from another org", async () => {
    setupReconciliationMocks(statementLineItem, otherOrgEntryLineItem);

    const response = await reconcileHandler(
      createEvent("POST /treasury/reconciliations", {
        treasuryAccountId: "52100000",
        year: "2026",
        statementLineId: "stmt-1",
        statementDate: "2026-01-15",
        movementLineId: "line-1",
      }),
    );
    const body = parseResponse(response);

    expect(response.statusCode).toBe(404);
    expect(body.message.code).toBe("ERROR_ACCOUNTING_MOVEMENT_NOT_FOUND");
  });

  test("POST /treasury/reconciliations rejects movement lines from another fiscal year", async () => {
    setupReconciliationMocks(statementLineItem, otherYearEntryLineItem);

    const response = await reconcileHandler(
      createEvent("POST /treasury/reconciliations", {
        treasuryAccountId: "52100000",
        year: "2026",
        statementLineId: "stmt-1",
        statementDate: "2026-01-15",
        movementLineId: "line-1",
      }),
    );
    const body = parseResponse(response);

    expect(response.statusCode).toBe(404);
    expect(body.message.code).toBe("ERROR_ACCOUNTING_MOVEMENT_NOT_FOUND");
  });

  test("POST /treasury/reconciliations rejects statement lines from another treasury account", async () => {
    setupReconciliationMocks(otherTreasuryStatementLineItem, entryLineItem);

    const response = await reconcileHandler(
      createEvent("POST /treasury/reconciliations", {
        treasuryAccountId: "52100000",
        year: "2026",
        statementLineId: "stmt-1",
        statementDate: "2026-01-15",
        movementLineId: "line-1",
      }),
    );
    const body = parseResponse(response);

    expect(response.statusCode).toBe(404);
    expect(body.message.code).toBe("ERROR_BANK_STATEMENT_LINE_NOT_FOUND");
  });

  test("POST /treasury/reconciliations rejects already matched statement lines", async () => {
    setupReconciliationMocks(matchedOutflowStatementLineItem, outflowCreditEntryLineItem);

    const response = await reconcileHandler(
      createEvent("POST /treasury/reconciliations", {
        treasuryAccountId: "52100000",
        year: "2026",
        statementLineId: "stmt-2",
        statementDate: "2026-01-16",
        movementLineId: "line-3",
      }),
    );
    const body = parseResponse(response);

    expect(response.statusCode).toBe(400);
    expect(body.message.code).toBe("ERROR_BANK_STATEMENT_LINE_ALREADY_RECONCILED");
  });

  test("POST /treasury/reconciliations rejects already reconciled movement lines", async () => {
    setupReconciliationMocks(statementLineItem, reconciledEntryLineItem);

    const response = await reconcileHandler(
      createEvent("POST /treasury/reconciliations", {
        treasuryAccountId: "52100000",
        year: "2026",
        statementLineId: "stmt-1",
        statementDate: "2026-01-15",
        movementLineId: "line-1",
      }),
    );
    const body = parseResponse(response);

    expect(response.statusCode).toBe(400);
    expect(body.message.code).toBe("ERROR_ACCOUNTING_MOVEMENT_ALREADY_RECONCILED");
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
        statementDate: { S: "2026-01-15" },
        movementLineId: { S: "line-1" },
        entryId: { S: "entry-1" },
        lineId: { S: "line-1" },
        amount: { N: "1000" },
        direction: { S: "INFLOW" },
        status: { S: "ACTIVE" },
        matchedAt: { S: "2026-01-15T00:00:00Z" },
        matchedBy: { S: "user-123" },
        entityType: { S: "RECONCILIATION_MATCH" },
      },
    });
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
    expect(transaction.TransactItems?.[1].Update?.Key).toEqual({
      PK: { S: "ORG#test-org#FY#2026" },
      SK: { S: "TRS#52100000#FY#2026#STMT#2026-01-15#stmt-1" },
    });
    expect(transaction.TransactItems?.[1].Update?.UpdateExpression).toContain(
      "SET #status = :unmatched REMOVE",
    );
    expect(transaction.TransactItems?.[2].Update?.UpdateExpression).toContain(
      "reconciliationStatus = :unmatched",
    );
    expect(body.data.status).toBe("CANCELLED");
    expect(body.data.entityType).toBeUndefined();
  });

  test("POST /treasury/reconciliations/{matchId}/cancel rejects already cancelled matches", async () => {
    dynamoMock.on(GetItemCommand).resolvesOnce({
      Item: {
        PK: { S: "ORG#test-org#FY#2026" },
        SK: { S: "TRS#52100000#FY#2026#RCN#RCN-1" },
        orgId: { S: "test-org" },
        treasuryAccountId: { S: "52100000" },
        matchId: { S: "RCN-1" },
        year: { S: "2026" },
        statementLineId: { S: "stmt-1" },
        statementDate: { S: "2026-01-15" },
        movementLineId: { S: "line-1" },
        amount: { N: "1000" },
        direction: { S: "INFLOW" },
        status: { S: "CANCELLED" },
        matchedAt: { S: "2026-01-15T00:00:00Z" },
        matchedBy: { S: "user-123" },
        cancelledAt: { S: "2026-01-16T00:00:00Z" },
        entityType: { S: "RECONCILIATION_MATCH" },
      },
    });

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

    expect(response.statusCode).toBe(400);
    expect(body.message.code).toBe("ERROR_RECONCILIATION_MATCH_ALREADY_CANCELLED");
    expect(dynamoMock.commandCalls(TransactWriteItemsCommand)).toHaveLength(0);
  });

  test("GET /treasury/reconciliations lists current org/year/account matches with pagination", async () => {
    const lastEvaluatedKey = {
      PK: { S: "ORG#test-org#FY#2026" },
      SK: { S: "TRS#52100000#FY#2026#RCN#RCN-1" },
    };
    dynamoMock.on(GetItemCommand).resolvesOnce({ Item: treasuryAccountItem });
    dynamoMock.on(QueryCommand).resolvesOnce({
      Items: [
        {
          ...lastEvaluatedKey,
          orgId: { S: "test-org" },
          treasuryAccountId: { S: "52100000" },
          matchId: { S: "RCN-1" },
          year: { S: "2026" },
          statementLineId: { S: "stmt-1" },
          statementDate: { S: "2026-01-15" },
          movementLineId: { S: "line-1" },
          amount: { N: "1000" },
          direction: { S: "INFLOW" },
          status: { S: "ACTIVE" },
          matchedAt: { S: "2026-01-15T00:00:00Z" },
          matchedBy: { S: "user-123" },
          entityType: { S: "RECONCILIATION_MATCH" },
        },
      ],
      LastEvaluatedKey: lastEvaluatedKey,
    });

    const response = await listReconciliationsHandler(
      createEvent(
        "GET /treasury/reconciliations",
        {},
        undefined,
        {
          treasuryAccountId: "52100000",
          year: "2026",
          limit: "1",
        },
      ),
    );
    const body = parseResponse(response);
    const queryInput = dynamoMock.commandCalls(QueryCommand)[0].args[0].input;

    expect(response.statusCode).toBe(200);
    expect(queryInput.KeyConditionExpression).toBe(
      "PK = :pk AND begins_with(SK, :sk)",
    );
    expect(queryInput.ExpressionAttributeValues).toMatchObject({
      ":pk": { S: "ORG#test-org#FY#2026" },
      ":sk": { S: "TRS#52100000#FY#2026#RCN#" },
    });
    expect(body.data.matches).toHaveLength(1);
    expect(body.data.nextCursor).toBeDefined();
    expect(body.data.hasMore).toBe(true);
    expect(body.data.count).toBe(1);
    expect(dynamoMock.commandCalls(ScanCommand)).toHaveLength(0);
  });
});
