// Mock environment variables
process.env.TABLE_NAME = "liass-ohada-AccountingTable";

import { mockClient } from "aws-sdk-client-mock";
import {
  DynamoDBClient,
  GetItemCommand,
  TransactWriteItemsCommand,
} from "@aws-sdk/client-dynamodb";
import { APIGatewayProxyEvent } from "aws-lambda";
import { handler } from "@/lambda/domains/core-ledger/entries/post-entry";
import { I18nResolver } from "@/lambda/shared/i18n";

const dynamoMock = mockClient(DynamoDBClient);

// Mock I18nResolver to verify correct message codes are used
jest.mock("@/lambda/shared/i18n", () => {
  return {
    I18nResolver: jest.fn().mockImplementation((acceptLanguage) => ({
      getMessage: jest.fn((code: string) => {
        const messages: Record<string, Record<string, string>> = {
          en: {
            SUCCESS_ENTRY_POSTED: "Entry successfully posted",
            ERROR_ENTRY_NOT_BALANCED: "Debit and credit amounts do not match",
            ERROR_FISCAL_YEAR_NOT_FOUND: "Fiscal year not found",
            ERROR_FISCAL_YEAR_LOCKED: "Fiscal year is locked or closed",
            ERROR_INVALID_INPUT: "Invalid input provided",
            ERROR_INTERNAL: "Internal server error",
          },
          fr: {
            SUCCESS_ENTRY_POSTED: "Entrée validée avec succès",
            ERROR_ENTRY_NOT_BALANCED:
              "Les montants débits et crédits ne correspondent pas",
            ERROR_FISCAL_YEAR_NOT_FOUND: "Exercice fiscal non trouvé",
            ERROR_FISCAL_YEAR_LOCKED: "Exercice fiscal est verrouillé ou fermé",
            ERROR_INVALID_INPUT: "Entrée invalide fournie",
            ERROR_INTERNAL: "Erreur interne du serveur",
          },
        };

        const locale = acceptLanguage?.includes("fr") ? "fr" : "en";
        return {
          code,
          message: messages[locale][code] || code,
        };
      }),
    })),
  };
});

describe("post-entry handler", () => {
  beforeEach(() => {
    dynamoMock.reset();
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  /**
   * Helper to create mock API Gateway event
   */
  const createMockEvent = (
    overrides: Partial<APIGatewayProxyEvent> = {}
  ): APIGatewayProxyEvent => ({
    resource: "/entries/post",
    path: "/entries/post",
    httpMethod: "POST",
    headers: {
      "Accept-Language": "en",
      "Content-Type": "application/json",
    },
    multiValueHeaders: {},
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    pathParameters: null,
    stageVariables: null,
    requestContext: {
      resourceId: "123",
      resourcePath: "/entries/post",
      httpMethod: "POST",
      extendedRequestId: "id123",
      requestTime: "12/Mar/2026:19:03:58 +0000",
      path: "/entries/post",
      accountId: "123456789012",
      protocol: "HTTP/1.1",
      stage: "prod",
      domainPrefix: "abcdefg",
      requestTimeEpoch: 1700000000000,
      requestId: "id123",
      identity: {
        sourceIp: "127.0.0.1",
        userAgent: "Custom User Agent String",
      },
      authorizer: {
        claims: {
          orgId: "test-org",
        },
      },
    } as any,
    body: "{}",
    isBase64Encoded: false,
    ...overrides,
  });

  /**
   * Helper to create mock FiscalYear item for DynamoDB
   */
  const createMockFiscalYear = (status = "OPEN") => ({
    PK: { S: "ORG#test-org" },
    SK: { S: "FY#2026" },
    orgId: { S: "test-org" },
    year: { N: "2026" },
    fiscalYearId: { S: "fy-2026" },
    startDate: { S: "2026-01-01" },
    endDate: { S: "2026-12-31" },
    status: { S: status },
    accountingStandard: { S: "SYSCOHADA_GENERAL" },
    entityType: { S: "FISCAL_YEAR" },
    createdAt: { S: "2026-01-01T00:00:00Z" },
    updatedAt: { S: "2026-01-01T00:00:00Z" },
  });

  describe("balanced entries", () => {
    test("should successfully post a balanced entry with debit=100, credit=100", async () => {
      // Mock FiscalYear retrieval
      dynamoMock.on(GetItemCommand).resolves({
        Item: createMockFiscalYear("OPEN"),
      });

      // Mock TransactWriteItems
      dynamoMock.on(TransactWriteItemsCommand).resolves({});

      const event = createMockEvent({
        body: JSON.stringify({
          year: 2026,
          entryDate: "2026-01-15",
          journalCode: "VENTES",
          lines: [
            {
              accountId: "41100000",
              debit: 100,
              credit: 0,
              description: "Credit customer invoice",
            },
            {
              accountId: "70100000",
              debit: 0,
              credit: 100,
              description: "Sales revenue",
            },
          ],
        }),
      });

      const response = await handler(event);

      expect(response.statusCode).toBe(201);
      expect(response.body).toBeDefined();
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.message.code).toBe("SUCCESS_ENTRY_POSTED");
      expect(body.data.totalDebit).toBe(100);
      expect(body.data.totalCredit).toBe(100);
      expect(body.data.entityType).toBe("ENTRY");
      expect(body.data.status).toBe("POSTED");
    });

    test("should successfully post entry with multiple lines (complex balance)", async () => {
      dynamoMock.on(GetItemCommand).resolves({
        Item: createMockFiscalYear("OPEN"),
      });
      dynamoMock.on(TransactWriteItemsCommand).resolves({});

      const event = createMockEvent({
        body: JSON.stringify({
          year: 2026,
          entryDate: "2026-01-15",
          journalCode: "ACHATS",
          lines: [
            {
              accountId: "41100000",
              debit: 200,
              credit: 0,
              description: "Invoice 1",
            },
            {
              accountId: "44100000",
              debit: 100,
              credit: 0,
              description: "Tax",
            },
            {
              accountId: "70100000",
              debit: 0,
              credit: 250,
              description: "Sales",
            },
            {
              accountId: "65100000",
              debit: 0,
              credit: 50,
              description: "Expenses",
            },
          ],
        }),
      });

      const response = await handler(event);

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.totalDebit).toBe(300);
      expect(body.data.totalCredit).toBe(300);
    });
  });

  describe("unbalanced entries", () => {
    test("should reject entry with debit > credit (150 vs 100)", async () => {
      dynamoMock.on(GetItemCommand).resolves({
        Item: createMockFiscalYear("OPEN"),
      });

      const event = createMockEvent({
        body: JSON.stringify({
          year: 2026,
          entryDate: "2026-01-15",
          journalCode: "VENTES",
          lines: [
            {
              accountId: "41100000",
              debit: 150,
              credit: 0,
              description: "Debit",
            },
            {
              accountId: "70100000",
              debit: 0,
              credit: 100,
              description: "Credit",
            },
          ],
        }),
      });

      const response = await handler(event);

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe("ERROR_ENTRY_NOT_BALANCED");
      expect(body.error.message).toBeDefined();
    });

    test("should reject entry with credit > debit (200 vs 100)", async () => {
      dynamoMock.on(GetItemCommand).resolves({
        Item: createMockFiscalYear("OPEN"),
      });

      const event = createMockEvent({
        body: JSON.stringify({
          year: 2026,
          entryDate: "2026-01-15",
          journalCode: "VENTES",
          lines: [
            {
              accountId: "41100000",
              debit: 100,
              credit: 0,
              description: "Debit",
            },
            {
              accountId: "70100000",
              debit: 0,
              credit: 200,
              description: "Credit",
            },
          ],
        }),
      });

      const response = await handler(event);

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe("ERROR_ENTRY_NOT_BALANCED");
    });

    test("should return French error message when Accept-Language is 'fr'", async () => {
      dynamoMock.on(GetItemCommand).resolves({
        Item: createMockFiscalYear("OPEN"),
      });

      const event = createMockEvent({
        headers: {
          "Accept-Language": "fr",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          year: 2026,
          entryDate: "2026-01-15",
          journalCode: "VENTES",
          lines: [
            {
              accountId: "41100000",
              debit: 100,
              credit: 0,
              description: "Debit",
            },
            {
              accountId: "70100000",
              debit: 0,
              credit: 150,
              description: "Credit",
            },
          ],
        }),
      });

      const response = await handler(event);

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe("ERROR_ENTRY_NOT_BALANCED");
      // Message should be in French (mocked version)
      expect(body.error.message).toContain(
        "débits et crédits ne correspondent pas"
      );
    });
  });

  describe("fiscal year validation", () => {
    test("should reject with ERROR_FISCAL_YEAR_NOT_FOUND when FY does not exist", async () => {
      dynamoMock.on(GetItemCommand).resolves({
        Item: undefined,
      });

      const event = createMockEvent({
        body: JSON.stringify({
          year: 2026,
          entryDate: "2026-01-15",
          journalCode: "VENTES",
          lines: [
            {
              accountId: "41100000",
              debit: 100,
              credit: 100,
              description: "Test",
            },
          ],
        }),
      });

      const response = await handler(event);

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe("ERROR_FISCAL_YEAR_NOT_FOUND");
    });

    test("should reject with ERROR_FISCAL_YEAR_LOCKED when FY status is LOCKED", async () => {
      dynamoMock.on(GetItemCommand).resolves({
        Item: createMockFiscalYear("LOCKED"),
      });

      const event = createMockEvent({
        body: JSON.stringify({
          year: 2026,
          entryDate: "2026-01-15",
          journalCode: "VENTES",
          lines: [
            {
              accountId: "41100000",
              debit: 100,
              credit: 100,
              description: "Test",
            },
          ],
        }),
      });

      const response = await handler(event);

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe("ERROR_FISCAL_YEAR_LOCKED");
    });

    test("should reject with ERROR_FISCAL_YEAR_LOCKED when FY status is CLOSED", async () => {
      dynamoMock.on(GetItemCommand).resolves({
        Item: createMockFiscalYear("CLOSED"),
      });

      const event = createMockEvent({
        body: JSON.stringify({
          year: 2026,
          entryDate: "2026-01-15",
          journalCode: "VENTES",
          lines: [
            {
              accountId: "41100000",
              debit: 100,
              credit: 100,
              description: "Test",
            },
          ],
        }),
      });

      const response = await handler(event);

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe("ERROR_FISCAL_YEAR_LOCKED");
    });
  });

  describe("validation errors", () => {
    test("should reject with ERROR_INVALID_INPUT for entry with missing required fields", async () => {
      dynamoMock.on(GetItemCommand).resolves({
        Item: createMockFiscalYear("OPEN"),
      });

      const event = createMockEvent({
        body: JSON.stringify({
          year: 2026,
          entryDate: "2026-01-15",
          journalCode: "VENTES",
          lines: [
            {
              // Missing accountId
              debit: 100,
              credit: 0,
              description: "Test",
            },
          ],
        }),
      });

      const response = await handler(event);

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe("ERROR_INVALID_INPUT");
    });

    test("should handle empty lines array gracefully", async () => {
      dynamoMock.on(GetItemCommand).resolves({
        Item: createMockFiscalYear("OPEN"),
      });
      dynamoMock.on(TransactWriteItemsCommand).resolves({});

      const event = createMockEvent({
        body: JSON.stringify({
          year: 2026,
          entryDate: "2026-01-15",
          journalCode: "VENTES",
          lines: [],
        }),
      });

      const response = await handler(event);

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.totalDebit).toBe(0);
      expect(body.data.totalCredit).toBe(0);
    });
  });

  describe("transact write items", () => {
    test("should successfully execute TransactWriteItems when entry is balanced", async () => {
      dynamoMock.on(GetItemCommand).resolves({
        Item: createMockFiscalYear("OPEN"),
      });

      dynamoMock.on(TransactWriteItemsCommand).resolves({});

      const event = createMockEvent({
        body: JSON.stringify({
          year: 2026,
          entryId: "ENT-123",
          entryDate: "2026-01-15",
          journalCode: "VENTES",
          lines: [
            {
              accountId: "41100000",
              debit: 100,
              credit: 0,
              description: "Debit",
            },
            {
              accountId: "70100000",
              debit: 0,
              credit: 100,
              description: "Credit",
            },
          ],
        }),
      });

      const response = await handler(event);

      // Should succeed when balanced
      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.totalDebit).toBe(100);
      expect(body.data.totalCredit).toBe(100);
    });
  });

  describe("error handling", () => {
    test("should return ERROR_INTERNAL when unexpected error occurs", async () => {
      dynamoMock
        .on(GetItemCommand)
        .rejects(new Error("Database connection failed"));

      const event = createMockEvent({
        body: JSON.stringify({
          year: 2026,
          entryDate: "2026-01-15",
          journalCode: "VENTES",
          lines: [
            {
              accountId: "41100000",
              debit: 100,
              credit: 100,
              description: "Test",
            },
          ],
        }),
      });

      const response = await handler(event);

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe("ERROR_INTERNAL");
    });
  });

  describe("i18n resolution", () => {
    test("should derive orgId from JWT claims (default test-org)", async () => {
      dynamoMock.on(GetItemCommand).resolves({
        Item: createMockFiscalYear("OPEN"),
      });

      dynamoMock.on(TransactWriteItemsCommand).resolves({});

      const event = createMockEvent({
        body: JSON.stringify({
          year: 2026,
          entryDate: "2026-01-15",
          journalCode: "VENTES",
          lines: [
            {
              accountId: "41100000",
              debit: 100,
              credit: 0,
              description: "Debit",
            },
            {
              accountId: "70100000",
              debit: 0,
              credit: 100,
              description: "Credit",
            },
          ],
        }),
      });

      const response = await handler(event);

      // Should succeed - verifies orgId is correctly derived
      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.orgId).toBe("test-org");
    });

    test("should default to 'en' locale when Accept-Language header is missing", async () => {
      dynamoMock.on(GetItemCommand).resolves({
        Item: createMockFiscalYear("OPEN"),
      });

      const event = createMockEvent({
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          year: 2026,
          entryDate: "2026-01-15",
          journalCode: "VENTES",
          lines: [
            {
              accountId: "41100000",
              debit: 100,
              credit: 0,
              description: "Debit",
            },
            {
              accountId: "70100000",
              debit: 0,
              credit: 150,
              description: "Credit",
            },
          ],
        }),
      });

      const response = await handler(event);

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      // English message should be used (contains "do not match" from mock)
      expect(body.error.message).toContain("do not match");
    });
  });
});
