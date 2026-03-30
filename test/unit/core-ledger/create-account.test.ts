import { handler } from "@/lambda/domains/core-ledger/accounts/create-account";
import {
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
} from "@aws-sdk/client-dynamodb";
import { mockClient } from "aws-sdk-client-mock";

const dynamoMock = mockClient(DynamoDBClient);

const createEvent = (body = {}, orgId = "test-org") => {
  return {
    version: "2.0",
    routeKey: "POST /accounts",
    rawPath: "/accounts",
    rawQueryString: "",
    headers: { "accept-language": "en" },
    requestContext: {
      accountId: "123456789012",
      apiId: "api-id",
      domainName: "localhost",
      domainPrefix: "localhost",
      http: {
        method: "POST",
        path: "/accounts",
        protocol: "HTTP/1.1",
        sourceIp: "127.0.0.1",
        userAgent: "jest",
      },
      requestId: "req-id",
      routeKey: "POST /accounts",
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
  };
};

describe("create-account handler", () => {
  beforeEach(() => {
    dynamoMock.reset();
    jest.clearAllMocks();
  });

  const parseResponse = (response: any) => {
    if (typeof response === "string") {
      return JSON.parse(response);
    }
    return JSON.parse(response.body ?? "{}");
  };

  test("creates account successfully", async () => {
    // account does not exist yet
    dynamoMock.on(GetItemCommand).resolves({ Item: undefined });

    // expect insert to succeed
    dynamoMock.on(PutItemCommand).resolves({});

    const newAccount = {
      accountId: "411",
      accountName: "Clients",
      accountNature: "BALANCE",
      accountUsage: "BOTH",
      isThirdPartyAccount: false,
      classCode: 4,
      financialStatementCode: "B01",
      allowReconciliation: true,
    };

    const response = await handler(createEvent(newAccount));
    const body = parseResponse(response);

    expect((response as any).statusCode).toBe(200);
    expect(body.message.code).toBe("SUCCESS_ACCOUNT_CREATED");
    expect(body.account.accountId).toBe("41100000");
  });

  test("returns 400 when account already exists", async () => {
    dynamoMock
      .on(GetItemCommand)
      .resolves({ Item: { PK: { S: "ORG#test-org" } } });

    const newAccount = {
      accountId: "411",
      accountName: "Clients",
      accountNature: "BALANCE",
      accountUsage: "BOTH",
      isThirdPartyAccount: false,
      classCode: 4,
      financialStatementCode: "B01",
      allowReconciliation: true,
    };

    const response = await handler(createEvent(newAccount));
    const body = parseResponse(response);

    expect((response as any).statusCode).toBe(400);
    expect(body.message.code).toBe("ERROR_ACCOUNT_ALREADY_EXISTS");
  });

  test("returns 400 for invalid input", async () => {
    const response = await handler(createEvent({ accountId: "411" }));
    const body = parseResponse(response);

    expect((response as any).statusCode).toBe(400);
    expect(body.message.code).toBe("ERROR_INVALID_INPUT");
  });
});
