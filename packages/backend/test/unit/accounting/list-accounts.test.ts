import { handler } from "@/lambda/domains/accounting/accounts/list-accounts";
import { TenantAccessService } from "@/lambda/shared/services/tenant-access-service";
import {
  DynamoDBClient,
  QueryCommand,
  ScanCommand,
} from "@aws-sdk/client-dynamodb";
import { mockClient } from "aws-sdk-client-mock";

const dynamoMock = mockClient(DynamoDBClient);

jest.mock("@/lambda/shared/services/tenant-access-service", () => ({
  TenantAccessService: {
    assertUserCanAccessOrg: jest.fn(),
  },
}));

const createEvent = (queryStringParameters?: Record<string, string>) => ({
  version: "2.0",
  routeKey: "GET /accounts",
  rawPath: "/accounts",
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
  queryStringParameters,
  isBase64Encoded: false,
});

const parseResponse = (response: any) => JSON.parse(response.body ?? "{}");

describe("list-accounts handler", () => {
  beforeEach(() => {
    dynamoMock.reset();
    jest.clearAllMocks();
    jest
      .mocked(TenantAccessService.assertUserCanAccessOrg)
      .mockResolvedValue({ role: "ACCOUNTANT" });
  });

  test("queries tenant accounts and returns frontend-safe DTOs", async () => {
    dynamoMock.on(QueryCommand).resolves({
      Items: [
        {
          PK: { S: "ORG#test-org" },
          SK: { S: "ACC#41100000" },
          orgId: { S: "test-org" },
          accountId: { S: "41100000" },
          accountName: { S: "Clients" },
          accountNature: { S: "BALANCE" },
          accountUsage: { S: "BOTH" },
          isThirdPartyAccount: { BOOL: true },
          classCode: { N: "4" },
          financialStatementCode: { S: "BS" },
          allowReconciliation: { BOOL: true },
          entityType: { S: "ACCOUNT" },
          createdAt: { S: "2026-01-01T00:00:00Z" },
          updatedAt: { S: "2026-01-01T00:00:00Z" },
        },
      ],
    });

    const response = await handler(createEvent({ limit: "25" }));
    const body = parseResponse(response);
    const queryInput = dynamoMock.commandCalls(QueryCommand)[0].args[0].input;

    expect(response.statusCode).toBe(200);
    expect(queryInput.KeyConditionExpression).toBe(
      "PK = :pk AND begins_with(SK, :sk)",
    );
    expect(queryInput.Limit).toBe(25);
    expect(body.data.accounts).toHaveLength(1);
    expect(body.data.items).toEqual(body.data.accounts);
    expect(body.data.accounts[0]).toEqual({
      orgId: "test-org",
      accountId: "41100000",
      accountName: "Clients",
      accountNature: "BALANCE",
      accountUsage: "BOTH",
      isThirdPartyAccount: true,
      requiresThirdParty: true,
      auxiliaryType: "CUSTOMER",
      classCode: 4,
      financialStatementCode: "BS",
      allowReconciliation: true,
      isActive: true,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    });
    expect(body.data.accounts[0].PK).toBeUndefined();
    expect(body.data.accounts[0].SK).toBeUndefined();
    expect(body.data.accounts[0].GSI1PK).toBeUndefined();
    expect(body.data.accounts[0].GSI1SK).toBeUndefined();
    expect(body.data.accounts[0].entityType).toBeUndefined();
    expect(body.data.items[0].PK).toBeUndefined();
    expect(body.data.items[0].SK).toBeUndefined();
    expect(body.data.items[0].GSI1PK).toBeUndefined();
    expect(body.data.items[0].GSI1SK).toBeUndefined();
    expect(body.data.items[0].entityType).toBeUndefined();
    expect(body.data.hasMore).toBe(false);
  });

  test("returns a cursor when DynamoDB paginates", async () => {
    dynamoMock.on(QueryCommand).resolves({
      Items: [],
      LastEvaluatedKey: {
        PK: { S: "ORG#test-org" },
        SK: { S: "ACC#51200000" },
      },
    });

    const response = await handler(createEvent());
    const body = parseResponse(response);

    expect(response.statusCode).toBe(200);
    expect(body.data.hasMore).toBe(true);
    expect(typeof body.data.nextCursor).toBe("string");
  });

  test("searches account codes by sort-key prefix without scanning", async () => {
    dynamoMock.on(QueryCommand).resolves({ Items: [] });

    const response = await handler(
      createEvent({
        search: "411",
        limit: "20",
        activeOnly: "true",
      }),
    );
    const queryInput = dynamoMock.commandCalls(QueryCommand)[0].args[0].input;

    expect(response.statusCode).toBe(200);
    expect(queryInput.ExpressionAttributeValues).toEqual(
      expect.objectContaining({
        ":sk": { S: "ACC#411" },
        ":active": { BOOL: true },
      }),
    );
    expect(queryInput.FilterExpression).toBe(
      "attribute_not_exists(#isActive) OR #isActive = :active",
    );
    expect(queryInput.Limit).toBe(20);
    expect(dynamoMock.commandCalls(ScanCommand)).toHaveLength(0);
  });

  test("supports class-prefix queries and rejects mismatched search scopes cheaply", async () => {
    dynamoMock.on(QueryCommand).resolves({ Items: [] });

    const classResponse = await handler(createEvent({ class: "5", limit: "20" }));
    const classQuery = dynamoMock.commandCalls(QueryCommand)[0].args[0].input;

    expect(classResponse.statusCode).toBe(200);
    expect(classQuery.ExpressionAttributeValues).toEqual(
      expect.objectContaining({
        ":sk": { S: "ACC#5" },
      }),
    );

    dynamoMock.resetHistory();
    const mismatchResponse = await handler(
      createEvent({ class: "4", search: "521", limit: "20" }),
    );

    expect(mismatchResponse.statusCode).toBe(200);
    expect(parseResponse(mismatchResponse).data).toEqual({
      accounts: [],
      hasMore: false,
      items: [],
    });
    expect(dynamoMock.commandCalls(QueryCommand)).toHaveLength(0);
    expect(dynamoMock.commandCalls(ScanCommand)).toHaveLength(0);
  });

  test("filters inactive accounts while preserving Query pagination", async () => {
    dynamoMock.on(QueryCommand).resolves({
      Items: [],
      LastEvaluatedKey: {
        PK: { S: "ORG#test-org" },
        SK: { S: "ACC#49999999" },
      },
    });

    const response = await handler(
      createEvent({ class: "4", active: "false", limit: "100" }),
    );
    const body = parseResponse(response);
    const queryInput = dynamoMock.commandCalls(QueryCommand)[0].args[0].input;

    expect(response.statusCode).toBe(200);
    expect(queryInput.ExpressionAttributeValues).toEqual(
      expect.objectContaining({
        ":sk": { S: "ACC#4" },
        ":active": { BOOL: false },
      }),
    );
    expect(queryInput.FilterExpression).toBe("#isActive = :active");
    expect(queryInput.Limit).toBe(100);
    expect(body.data.hasMore).toBe(true);
    expect(body.data.nextCursor).toEqual(expect.any(String));
    expect(dynamoMock.commandCalls(ScanCommand)).toHaveLength(0);
  });
});
