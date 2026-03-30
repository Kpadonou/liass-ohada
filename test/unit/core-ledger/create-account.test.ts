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
    body: JSON.stringify(body),
    headers: { "accept-language": "en" },
    requestContext: {
      authorizer: {
        jwt: {
          claims: { orgId },
        },
      },
    },
    isBase64Encoded: false,
  };
};

describe("create-account handler", () => {
  beforeEach(() => {
    dynamoMock.reset();
    jest.clearAllMocks();
  });

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
    const body = JSON.parse(response.body);

    expect(response.statusCode).toBe(200);
    expect(body.message.code).toBe("SUCCESS_ACCOUNT_CREATED");
    expect(body.data.account.accountId).toBe("41100000");
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
    const body = JSON.parse(response.body);

    expect(response.statusCode).toBe(400);
    expect(body.message.code).toBe("ERROR_ACCOUNT_ALREADY_EXISTS");
  });

  test("returns 400 for invalid input", async () => {
    const response = await handler(createEvent({ accountId: "411" }));
    const body = JSON.parse(response.body);

    expect(response.statusCode).toBe(400);
    expect(body.message.code).toBe("ERROR_INVALID_INPUT");
  });
});
