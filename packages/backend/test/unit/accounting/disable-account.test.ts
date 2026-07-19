import { handler } from "@/lambda/domains/accounting/accounts/disable-account";
import { TenantAccessService } from "@/lambda/shared/services/tenant-access-service";
import { DynamoDBClient, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { marshall } from "@aws-sdk/util-dynamodb";
import { mockClient } from "aws-sdk-client-mock";

const dynamoMock = mockClient(DynamoDBClient);

jest.mock("@/lambda/shared/services/tenant-access-service", () => ({
  TenantAccessService: {
    assertUserCanAccessOrg: jest.fn(),
  },
}));

const createEvent = (accountId = "411", orgId = "test-org") => ({
  version: "2.0",
  routeKey: "DELETE /accounts/{accountId}",
  rawPath: `/accounts/${accountId}`,
  rawQueryString: "",
  headers: { "accept-language": "en", "x-org-id": orgId },
  pathParameters: { accountId },
  requestContext: {
    accountId: "123456789012",
    apiId: "api-id",
    domainName: "localhost",
    domainPrefix: "localhost",
    http: {
      method: "DELETE",
      path: `/accounts/${accountId}`,
      protocol: "HTTP/1.1",
      sourceIp: "127.0.0.1",
      userAgent: "jest",
    },
    requestId: "req-id",
    routeKey: "DELETE /accounts/{accountId}",
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
  body: JSON.stringify({}),
  isBase64Encoded: false,
});

const parseResponse = (response: any) => JSON.parse(response.body ?? "{}");

describe("disable-account handler", () => {
  beforeEach(() => {
    dynamoMock.reset();
    jest.clearAllMocks();
    jest
      .mocked(TenantAccessService.assertUserCanAccessOrg)
      .mockResolvedValue({ role: "ACCOUNTANT", workspaceType: "COMPANY" });
  });

  test("soft-disables an account without exposing persistence keys", async () => {
    dynamoMock.on(UpdateItemCommand).resolves({
      Attributes: marshall({
        orgId: "test-org",
        accountId: "41100000",
        accountName: "Clients",
        accountNature: "BALANCE",
        accountUsage: "BOTH",
        isThirdPartyAccount: true,
        classCode: 4,
        financialStatementCode: "B01",
        allowReconciliation: true,
        isActive: false,
        entityType: "ACCOUNT",
        PK: "ORG#test-org",
        SK: "ACC#41100000",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-06-16T00:00:00.000Z",
      }),
    });

    const response = await handler(createEvent("411"));
    const body = parseResponse(response);
    const updateCommand = dynamoMock.commandCalls(UpdateItemCommand)[0].args[0].input;

    expect((response as any).statusCode).toBe(200);
    expect(updateCommand.UpdateExpression).toContain("#isActive = :isActive");
    expect(updateCommand.ConditionExpression).toBe(
      "attribute_exists(PK) AND attribute_exists(SK)",
    );
    expect(body.message.code).toBe("SUCCESS_ACCOUNT_DISABLED");
    expect(body.account).toMatchObject({
      accountId: "41100000",
      accountName: "Clients",
      isActive: false,
    });
    expect(body.account.PK).toBeUndefined();
    expect(body.account.SK).toBeUndefined();
    expect(body.account.entityType).toBeUndefined();
  });
});
