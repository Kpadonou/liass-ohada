import { handler } from "@/lambda/domains/core-ledger/fiscal-year/lock-period";
import {
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
} from "@aws-sdk/client-dynamodb";
import { mockClient } from "aws-sdk-client-mock";

const dynamoMock = mockClient(DynamoDBClient);

const createEvent = (body = {}, orgId = "test-org") => ({
  version: "2.0",
  routeKey: "POST /fiscal-year/{year}/lock",
  rawPath: "/fiscal-year/2026/lock",
  rawQueryString: "",
  headers: { "accept-language": "en" },
  requestContext: {
    accountId: "123456789012",
    apiId: "api-id",
    domainName: "localhost",
    domainPrefix: "localhost",
    http: {
      method: "POST",
      path: "/fiscal-year/2026/lock",
      protocol: "HTTP/1.1",
      sourceIp: "127.0.0.1",
      userAgent: "jest",
    },
    requestId: "req-id",
    routeKey: "POST /fiscal-year/{year}/lock",
    stage: "test",
    time: "01/Jan/1970:00:00:00 +0000",
    timeEpoch: 0,
    authorizer: {
      principalId: "user-123",
      integrationLatency: 0,
      jwt: {
        claims: { orgId },
        scopes: [],
      },
    },
  },
  body: JSON.stringify(body),
  isBase64Encoded: false,
});

const parseResponse = (response: any) => {
  if (typeof response === "string") {
    return JSON.parse(response);
  }
  return JSON.parse(response.body ?? "{}");
};

describe("lock-period handler", () => {
  beforeEach(() => {
    dynamoMock.reset();
    jest.clearAllMocks();
  });

  test("locks a period successfully", async () => {
    dynamoMock.on(GetItemCommand).resolves({
      Item: {
        PK: { S: "ORG#test-org" },
        SK: { S: "FY#2026" },
        orgId: { S: "test-org" },
        year: { N: "2026" },
        fiscalYearId: { S: "FY2026" },
        startDate: { S: "2026-01-01" },
        endDate: { S: "2026-12-31" },
        status: { S: "OPEN" },
        accountingStandard: { S: "SYSCOHADA_GENERAL" },
        entityType: { S: "FISCAL_YEAR" },
        createdAt: { S: "2026-01-01T00:00:00.000Z" },
        updatedAt: { S: "2026-01-01T00:00:00.000Z" },
      },
    });

    dynamoMock.on(PutItemCommand).resolves({});

    const response = await handler(
      createEvent({ year: 2026, month: 3, status: "LOCKED" }),
    );
    const body = parseResponse(response);

    expect((response as any).statusCode).toBe(200);
    expect(body.message.code).toBe("SUCCESS_PERIOD_LOCKED");
    expect(body.lockItem).toMatchObject({
      status: "LOCKED",
      year: 2026,
      month: "03",
    });
  });

  test("rejects lock when fiscal year is closed", async () => {
    dynamoMock.on(GetItemCommand).resolves({
      Item: {
        PK: { S: "ORG#test-org" },
        SK: { S: "FY#2026" },
        orgId: { S: "test-org" },
        year: { N: "2026" },
        fiscalYearId: { S: "FY2026" },
        startDate: { S: "2026-01-01" },
        endDate: { S: "2026-12-31" },
        status: { S: "CLOSED" },
        accountingStandard: { S: "SYSCOHADA_GENERAL" },
        entityType: { S: "FISCAL_YEAR" },
        createdAt: { S: "2026-01-01T00:00:00.000Z" },
        updatedAt: { S: "2026-01-01T00:00:00.000Z" },
      },
    });

    const response = await handler(
      createEvent({ year: 2026, month: 3, status: "LOCKED" }),
    );
    const body = parseResponse(response);

    expect((response as any).statusCode).toBe(400);
    expect(body.message.code).toBe("ERROR_FISCAL_YEAR_LOCKED");
  });

  test("returns error for invalid month", async () => {
    const response = await handler(
      createEvent({ year: 2026, month: 13, status: "LOCKED" }),
    );
    const body = parseResponse(response);

    expect((response as any).statusCode).toBe(400);
    expect(body.message.code).toBe("ERROR_INVALID_INPUT");
  });
});
