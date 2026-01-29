import { mockClient } from "aws-sdk-client-mock";
import {
  DynamoDBClient,
  GetItemCommand,
  TransactWriteItemsCommand,
} from "@aws-sdk/client-dynamodb";
import { APIGatewayProxyEvent } from "aws-lambda";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { handler } from "@/lambda/domains/core-ledger/entries/post-entry";

const dynamoMock = mockClient(DynamoDBClient);

// Mock environment variables
process.env.TABLE_NAME = "liass-ohada-AccountingTable";

// Simple random integer generator (avoids faker ESM issues)
const randomInt = (min: number, max: number) => {
  return Math.floor(Math.random() * (max - min + 1)) + min;
};

const randomString = () => Math.random().toString(36).substring(7);

// Mock I18nResolver to verify correct message codes and localized text
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

describe("post-entry handler (unit tests with integer amounts)", () => {
  beforeEach(() => {
    dynamoMock.reset();
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  const createMockEvent = (
    overrides: Partial<APIGatewayProxyEvent> = {}
  ): APIGatewayProxyEvent => ({
    resource: "/entries/post",
    path: "/entries/post",
    httpMethod: "POST",
    headers: {
      "Accept-Language": "en",
      "Content-Type": "application/json",
      ...overrides.headers,
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
      requestTime: "29/Jan/2026:12:00:00 +0000",
      path: "/entries/post",
      accountId: "123456789012",
      protocol: "HTTP/1.1",
      stage: "prod",
      domainPrefix: "abcdefg",
      requestTimeEpoch: 1700000000000,
      requestId: "id123",
      apiId: "api-id-123",
      identity: {
        sourceIp: "127.0.0.1",
        userAgent: "Custom User Agent String",
        cognitoIdentityPoolId: undefined,
        accountId: undefined,
        cognitoIdentityId: undefined,
        caller: undefined,
        apiKey: undefined,
        apiKeyId: undefined,
        principalOrgId: undefined,
        accessKey: undefined,
        cognitoAuthenticationType: undefined,
        cognitoAuthenticationProvider: undefined,
        userArn: undefined,
      } as any,
      authorizer: {
        claims: {
          orgId: "test-org",
          userId: "user-123",
        },
      },
    } as any,
    body: "{}",
    isBase64Encoded: false,
    ...overrides,
  });

  const createMockFiscalYear = (status: "OPEN" | "LOCKED" | "CLOSED") =>
    marshall({
      pk: "ORG#test-org",
      sk: "FY#2026",
      year: 2026,
      fiscalYearId: "FY-2026-001",
      startDate: "2026-01-01",
      endDate: "2026-12-31",
      status,
      accountingStandard: "SYSCOHADA_GENERAL",
      entityType: "FISCAL_YEAR",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    });

  const createBalancedLines = (amount: number) => [
    {
      accountId: "41100000",
      debit: amount,
      credit: 0,
      description: "Client invoice",
    },
    {
      accountId: "70100000",
      debit: 0,
      credit: amount,
      description: "Sales revenue",
    },
  ];

  const createUnbalancedLines = (debitAmount: number, creditAmount: number) => [
    {
      accountId: "41100000",
      debit: debitAmount,
      credit: 0,
      description: "Client invoice",
    },
    {
      accountId: "70100000",
      debit: 0,
      credit: creditAmount,
      description: "Sales revenue",
    },
  ];

  describe("balanced entries with integer amounts", () => {
    test("should successfully post balanced entry with integer amounts", async () => {
      const amount = randomInt(1000, 1000000);

      dynamoMock.on(GetItemCommand).resolves({
        Item: createMockFiscalYear("OPEN"),
      });
      dynamoMock.on(TransactWriteItemsCommand).resolves({});

      const event = createMockEvent({
        body: JSON.stringify({
          year: 2026,
          entryDate: "2026-01-29",
          journalCode: "VENTES",
          lines: createBalancedLines(amount),
        }),
      });

      const response = await handler(event);
      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(201);
      expect(body.success).toBe(true);
      expect(body.data.totalDebit).toBe(amount);
      expect(body.data.totalCredit).toBe(amount);
      expect(Number.isInteger(body.data.totalDebit)).toBe(true);
      expect(Number.isInteger(body.data.totalCredit)).toBe(true);
    });

    test("should enforce strict integer equality", async () => {
      const amount = randomInt(1000, 100000);

      dynamoMock.on(GetItemCommand).resolves({
        Item: createMockFiscalYear("OPEN"),
      });
      dynamoMock.on(TransactWriteItemsCommand).resolves({});

      const event = createMockEvent({
        body: JSON.stringify({
          year: 2026,
          entryDate: "2026-01-29",
          journalCode: "VENTES",
          lines: createBalancedLines(amount),
        }),
      });

      const response = await handler(event);
      const body = JSON.parse(response.body);

      expect(body.data.totalDebit === body.data.totalCredit).toBe(true);
    });

    test("should validate TransactWriteItems integer amounts", async () => {
      const amount = randomInt(5000, 500000);

      dynamoMock.on(GetItemCommand).resolves({
        Item: createMockFiscalYear("OPEN"),
      });
      dynamoMock.on(TransactWriteItemsCommand).resolves({});

      const event = createMockEvent({
        body: JSON.stringify({
          year: 2026,
          entryDate: "2026-01-29",
          journalCode: "VENTES",
          lines: createBalancedLines(amount),
        }),
      });

      await handler(event);

      const transactCall = dynamoMock.commandCalls(TransactWriteItemsCommand)[0];
      const transactItems = (transactCall.args[0] as any).input.TransactItems;

      for (const item of transactItems) {
        const unmarshalled = unmarshall(item.Put.Item);
        if (unmarshalled.entityType === "ENTRY") {
          expect(Number.isInteger(unmarshalled.totalDebit)).toBe(true);
          expect(Number.isInteger(unmarshalled.totalCredit)).toBe(true);
        }
        if (unmarshalled.entityType === "ENTRY_LINE") {
          expect(Number.isInteger(unmarshalled.debit)).toBe(true);
          expect(Number.isInteger(unmarshalled.credit)).toBe(true);
        }
      }
    });
  });

  describe("unbalanced entries", () => {
    test("should reject unbalanced entry with ERROR_ENTRY_NOT_BALANCED", async () => {
      const debit = randomInt(1000, 50000);
      const credit = randomInt(debit + 100, debit + 10000);

      dynamoMock.on(GetItemCommand).resolves({
        Item: createMockFiscalYear("OPEN"),
      });

      const event = createMockEvent({
        body: JSON.stringify({
          year: 2026,
          entryDate: "2026-01-29",
          journalCode: "VENTES",
          lines: createUnbalancedLines(debit, credit),
        }),
      });

      const response = await handler(event);
      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(400);
      expect(body.error.code).toBe("ERROR_ENTRY_NOT_BALANCED");
    });

    test("should return French message on unbalance", async () => {
      const debit = randomInt(1000, 50000);
      const credit = debit + randomInt(100, 1000);

      dynamoMock.on(GetItemCommand).resolves({
        Item: createMockFiscalYear("OPEN"),
      });

      const event = createMockEvent({
        headers: { "Accept-Language": "fr", "Content-Type": "application/json" },
        body: JSON.stringify({
          year: 2026,
          entryDate: "2026-01-29",
          journalCode: "VENTES",
          lines: createUnbalancedLines(debit, credit),
        }),
      });

      const response = await handler(event);
      const body = JSON.parse(response.body);

      expect(body.error.code).toBe("ERROR_ENTRY_NOT_BALANCED");
      expect(body.error.message).toContain("montants débits et crédits");
    });
  });

  describe("fiscal year validation", () => {
    test("should reject locked fiscal year", async () => {
      const amount = randomInt(1000, 100000);

      dynamoMock.on(GetItemCommand).resolves({
        Item: createMockFiscalYear("LOCKED"),
      });

      const event = createMockEvent({
        body: JSON.stringify({
          year: 2026,
          entryDate: "2026-01-29",
          journalCode: "VENTES",
          lines: createBalancedLines(amount),
        }),
      });

      const response = await handler(event);
      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(400);
      expect(body.error.code).toBe("ERROR_FISCAL_YEAR_LOCKED");
    });

    test("should reject closed fiscal year", async () => {
      const amount = randomInt(1000, 100000);

      dynamoMock.on(GetItemCommand).resolves({
        Item: createMockFiscalYear("CLOSED"),
      });

      const event = createMockEvent({
        body: JSON.stringify({
          year: 2026,
          entryDate: "2026-01-29",
          journalCode: "VENTES",
          lines: createBalancedLines(amount),
        }),
      });

      const response = await handler(event);
      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(400);
      expect(body.error.code).toBe("ERROR_FISCAL_YEAR_LOCKED");
    });

    test("should reject missing fiscal year", async () => {
      const amount = randomInt(1000, 100000);

      dynamoMock.on(GetItemCommand).resolves({});

      const event = createMockEvent({
        body: JSON.stringify({
          year: 2099,
          entryDate: "2099-01-29",
          journalCode: "VENTES",
          lines: createBalancedLines(amount),
        }),
      });

      const response = await handler(event);
      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(400);
      expect(body.error.code).toBe("ERROR_FISCAL_YEAR_NOT_FOUND");
    });
  });

  describe("error handling", () => {
    test("should return ERROR_INTERNAL on DB error", async () => {
      dynamoMock
        .on(GetItemCommand)
        .rejects(new Error("Database connection failed"));

      const amount = randomInt(1000, 100000);

      const event = createMockEvent({
        body: JSON.stringify({
          year: 2026,
          entryDate: "2026-01-29",
          journalCode: "VENTES",
          lines: createBalancedLines(amount),
        }),
      });

      const response = await handler(event);
      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(400);
      expect(body.error.code).toBe("ERROR_INTERNAL");
    });

    test("should reject missing accountId", async () => {
      dynamoMock.on(GetItemCommand).resolves({
        Item: createMockFiscalYear("OPEN"),
      });

      const event = createMockEvent({
        body: JSON.stringify({
          year: 2026,
          entryDate: "2026-01-29",
          journalCode: "VENTES",
          lines: [
            {
              debit: 1000,
              credit: 0,
              description: "Test",
            },
          ],
        }),
      });

      const response = await handler(event);
      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(400);
      expect(body.error.code).toBe("ERROR_INVALID_INPUT");
    });

    test("should reject negative amounts", async () => {
      dynamoMock.on(GetItemCommand).resolves({
        Item: createMockFiscalYear("OPEN"),
      });

      const event = createMockEvent({
        body: JSON.stringify({
          year: 2026,
          entryDate: "2026-01-29",
          journalCode: "VENTES",
          lines: [
            {
              accountId: "41100000",
              debit: -1000,
              credit: 0,
              description: "Test",
            },
          ],
        }),
      });

      const response = await handler(event);
      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(400);
      expect(body.error.code).toBe("ERROR_INVALID_INPUT");
    });

    test("should handle empty lines", async () => {
      dynamoMock.on(GetItemCommand).resolves({
        Item: createMockFiscalYear("OPEN"),
      });
      dynamoMock.on(TransactWriteItemsCommand).resolves({});

      const event = createMockEvent({
        body: JSON.stringify({
          year: 2026,
          entryDate: "2026-01-29",
          journalCode: "VENTES",
          lines: [],
        }),
      });

      const response = await handler(event);
      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(201);
      expect(body.data.totalDebit).toBe(0);
      expect(body.data.totalCredit).toBe(0);
      expect(Number.isInteger(body.data.totalDebit)).toBe(true);
      expect(Number.isInteger(body.data.totalCredit)).toBe(true);
    });
  });

  describe("i18n and randomization", () => {
    test("should handle random orgId", async () => {
      const amount = randomInt(1000, 100000);

      dynamoMock.on(GetItemCommand).resolves({
        Item: createMockFiscalYear("OPEN"),
      });
      dynamoMock.on(TransactWriteItemsCommand).resolves({});

      const event = createMockEvent({
        body: JSON.stringify({
          year: 2026,
          entryDate: "2026-01-29",
          journalCode: "VENTES",
          lines: createBalancedLines(amount),
        }),
        requestContext: {
          ...createMockEvent().requestContext,
          authorizer: {
            claims: {
              orgId: randomString(),
              userId: randomString(),
            },
          },
        },
      });

      const response = await handler(event);
      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(201);
      expect(body.success).toBe(true);
    });

    test("should default to English locale", async () => {
      const amount = randomInt(1000, 100000);

      dynamoMock.on(GetItemCommand).resolves({
        Item: createMockFiscalYear("OPEN"),
      });
      dynamoMock.on(TransactWriteItemsCommand).resolves({});

      const event = createMockEvent({
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          year: 2026,
          entryDate: "2026-01-29",
          journalCode: "VENTES",
          lines: createBalancedLines(amount),
        }),
      });

      const response = await handler(event);
      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(201);
      expect(body.message.code).toBe("SUCCESS_ENTRY_POSTED");
      expect(body.message.message).toContain("successfully posted");
    });

    test("should support multiple locales", async () => {
      const debit = randomInt(1000, 50000);
      const credit = debit + randomInt(100, 1000);

      dynamoMock.on(GetItemCommand).resolves({
        Item: createMockFiscalYear("OPEN"),
      });

      // Test English
      const eventEn = createMockEvent({
        headers: { "Accept-Language": "en", "Content-Type": "application/json" },
        body: JSON.stringify({
          year: 2026,
          entryDate: "2026-01-29",
          journalCode: "VENTES",
          lines: createUnbalancedLines(debit, credit),
        }),
      });

      const responseEn = await handler(eventEn);
      const bodyEn = JSON.parse(responseEn.body);

      expect(bodyEn.error.code).toBe("ERROR_ENTRY_NOT_BALANCED");
      expect(bodyEn.error.message).toContain("do not match");

      // Test French
      const eventFr = createMockEvent({
        headers: { "Accept-Language": "fr", "Content-Type": "application/json" },
        body: JSON.stringify({
          year: 2026,
          entryDate: "2026-01-29",
          journalCode: "VENTES",
          lines: createUnbalancedLines(debit, credit),
        }),
      });

      const responseFr = await handler(eventFr);
      const bodyFr = JSON.parse(responseFr.body);

      expect(bodyFr.error.code).toBe("ERROR_ENTRY_NOT_BALANCED");
      expect(bodyFr.error.message).toContain("montants débits et crédits");
    });
  });
});
