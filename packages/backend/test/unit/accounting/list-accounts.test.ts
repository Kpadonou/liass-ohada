import { handler } from "@/lambda/domains/accounting/accounts/list-accounts";
import { TenantAccessService } from "@/lambda/shared/services/tenant-access-service";
import { DynamoDBClient, QueryCommand } from "@aws-sdk/client-dynamodb";
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
    expect(body.data.accounts[0]).toEqual({
      orgId: "test-org",
      accountId: "41100000",
      accountName: "Clients",
      accountNature: "BALANCE",
      accountUsage: "BOTH",
      isThirdPartyAccount: true,
      classCode: 4,
      financialStatementCode: "BS",
      allowReconciliation: true,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    });
    expect(body.data.accounts[0].PK).toBeUndefined();
    expect(body.data.accounts[0].SK).toBeUndefined();
    expect(body.data.accounts[0].GSI1PK).toBeUndefined();
    expect(body.data.accounts[0].GSI1SK).toBeUndefined();
    expect(body.data.accounts[0].entityType).toBeUndefined();
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
});
