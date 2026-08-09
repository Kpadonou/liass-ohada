import { allowAccountingProductAccess } from "@/test/helpers/product-access";
import { handler } from "@/lambda/domains/accounting/fiscal-year/lock-period";
import { handler as closePeriodHandler } from "@/lambda/domains/accounting/fiscal-year/close-period";
import { TenantAccessService } from "@/lambda/shared/services/tenant-access-service";
import {
  DynamoDBClient,
  GetItemCommand,
  UpdateItemCommand,
} from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import { mockClient } from "aws-sdk-client-mock";

const dynamoMock = mockClient(DynamoDBClient);

jest.mock("@/lambda/shared/services/tenant-access-service", () => ({
  TenantAccessService: {
    assertUserCanAccessOrg: jest.fn(),
  },
}));

const createEvent = (body = {}, orgId = "test-org") => ({
  version: "2.0",
  routeKey: "POST /fiscal-year/{year}/lock",
  rawPath: "/fiscal-year/2026/lock",
  rawQueryString: "",
  headers: { "accept-language": "en", "x-org-id": orgId },
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
        claims: { sub: "user-123" },
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
    allowAccountingProductAccess();
    dynamoMock.reset();
    jest.clearAllMocks();
    jest
      .mocked(TenantAccessService.assertUserCanAccessOrg)
      .mockResolvedValue({ role: "ACCOUNTANT", workspaceType: "COMPANY" });
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
        accountingFramework: { S: "SYSCOHADA_REVISED" },
        entityType: { S: "FISCAL_YEAR" },
        createdAt: { S: "2026-01-01T00:00:00.000Z" },
        updatedAt: { S: "2026-01-01T00:00:00.000Z" },
      },
    });

    dynamoMock.on(UpdateItemCommand).resolves({
      Attributes: {
        PK: { S: "ORG#test-org#FY#2026" },
        SK: { S: "LOCK#PERIOD#03" },
        orgId: { S: "test-org" },
        year: { N: "2026" },
        month: { S: "03" },
        status: { S: "LOCKED" },
        entityType: { S: "PERIOD_LOCK" },
        createdBy: { S: "user-123" },
        createdAt: { S: "2026-01-01T00:00:00.000Z" },
        updatedBy: { S: "user-123" },
        updatedAt: { S: "2026-01-01T00:00:00.000Z" },
      },
    });

    const response = await handler(
      createEvent({ year: 2026, month: 3, status: "LOCKED" }),
    );
    const body = parseResponse(response);

    expect((response as any).statusCode).toBe(200);
    expect(body.message.code).toBe("SUCCESS_PERIOD_LOCKED");
    expect(body.data).toMatchObject({
      status: "LOCKED",
      year: 2026,
      month: "03",
    });
    expect(body.data.PK).toBeUndefined();
    expect(body.data.SK).toBeUndefined();
  });

  test("closes a period idempotently with tenant-scoped keys", async () => {
    dynamoMock.on(GetItemCommand).resolves({
      Item: {
        PK: { S: "ORG#tenant-b" },
        SK: { S: "FY#2026" },
        orgId: { S: "tenant-b" },
        year: { N: "2026" },
        fiscalYearId: { S: "FY2026" },
        startDate: { S: "2026-01-01" },
        endDate: { S: "2026-12-31" },
        status: { S: "OPEN" },
        accountingFramework: { S: "SYSCOHADA_REVISED" },
        entityType: { S: "FISCAL_YEAR" },
        createdAt: { S: "2026-01-01T00:00:00.000Z" },
        updatedAt: { S: "2026-01-01T00:00:00.000Z" },
      },
    });
    dynamoMock.on(UpdateItemCommand).resolves({
      Attributes: {
        PK: { S: "ORG#tenant-b#FY#2026" },
        SK: { S: "LOCK#PERIOD#04" },
        orgId: { S: "tenant-b" },
        year: { N: "2026" },
        month: { S: "04" },
        status: { S: "LOCKED" },
        entityType: { S: "PERIOD_LOCK" },
        createdBy: { S: "user-123" },
        createdAt: { S: "2026-01-01T00:00:00.000Z" },
        updatedBy: { S: "user-123" },
        updatedAt: { S: "2026-01-02T00:00:00.000Z" },
      },
    });

    const response = await closePeriodHandler(
      {
        ...createEvent({}, "tenant-b"),
        routeKey: "POST /fiscal-year/{year}/periods/{month}/close",
        rawPath: "/fiscal-year/2026/periods/4/close",
        pathParameters: { year: "2026", month: "4" },
        body: undefined,
      } as any,
    );
    const body = parseResponse(response);
    const updateInput =
      dynamoMock.commandCalls(UpdateItemCommand)[0].args[0].input;
    const key = unmarshall(updateInput.Key ?? {});

    expect((response as any).statusCode).toBe(200);
    expect(key).toEqual({
      PK: "ORG#tenant-b#FY#2026",
      SK: "LOCK#PERIOD#04",
    });
    expect(updateInput.UpdateExpression).toContain("if_not_exists(createdAt");
    expect(body.data).toMatchObject({
      year: 2026,
      month: "04",
      status: "LOCKED",
    });
    expect(body.data.PK).toBeUndefined();
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
        accountingFramework: { S: "SYSCOHADA_REVISED" },
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
