import { handler } from "@/lambda/domains/accounting/entries/list-entries";
import { TenantAccessService } from "@/lambda/shared/services/tenant-access-service";
import { DynamoDBClient, QueryCommand, ScanCommand } from "@aws-sdk/client-dynamodb";
import { mockClient } from "aws-sdk-client-mock";

const dynamoMock = mockClient(DynamoDBClient);

jest.mock("@/lambda/shared/services/tenant-access-service", () => ({
  TenantAccessService: {
    assertUserCanAccessOrg: jest.fn(),
  },
}));

const createEvent = (queryStringParameters: Record<string, string>) => ({
  version: "2.0",
  routeKey: "GET /entries",
  rawPath: "/entries",
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

describe("list-entries handler", () => {
  beforeEach(() => {
    dynamoMock.reset();
    jest.clearAllMocks();
    jest
      .mocked(TenantAccessService.assertUserCanAccessOrg)
      .mockResolvedValue({ role: "ACCOUNTANT", workspaceType: "COMPANY" });
  });

  test("queries GSI5 for fiscal-year entry summaries", async () => {
    dynamoMock.on(QueryCommand).resolves({
      Items: [
        {
          PK: { S: "ORG#test-org#FY#2026" },
          SK: { S: "E#E-001" },
          GSI5PK: { S: "ORG#test-org#FY#2026" },
          GSI5SK: { S: "JNL#SALES#DT#2026-01-15#E#E-001" },
          orgId: { S: "test-org" },
          year: { N: "2026" },
          entryId: { S: "E-001" },
          entryDate: { S: "2026-01-15" },
          journalCode: { S: "SALES" },
          label: { S: "Invoice posted" },
          totalDebit: { N: "1000" },
          totalCredit: { N: "1000" },
          status: { S: "POSTED" },
          entityType: { S: "ENTRY" },
          createdAt: { S: "2026-01-15T00:00:00Z" },
          updatedAt: { S: "2026-01-15T00:00:00Z" },
        },
      ],
    });

    const response = await handler(createEvent({ year: "2026", limit: "20" }));
    const body = parseResponse(response);
    const queryInput = dynamoMock.commandCalls(QueryCommand)[0].args[0].input;

    expect(response.statusCode).toBe(200);
    expect(queryInput.IndexName).toBe("GSI5");
    expect(queryInput.KeyConditionExpression).toBe("GSI5PK = :pk");
    expect(queryInput.Limit).toBe(20);
    expect(dynamoMock.commandCalls(ScanCommand)).toHaveLength(0);
    expect(body.data.entries[0]).toEqual({
      entryId: "E-001",
      year: 2026,
      entryDate: "2026-01-15",
      journalCode: "SALES",
      label: "Invoice posted",
      totalDebit: 1000,
      totalCredit: 1000,
      status: "POSTED",
      createdAt: "2026-01-15T00:00:00Z",
      updatedAt: "2026-01-15T00:00:00Z",
    });
    expect(body.data.entries[0].PK).toBeUndefined();
    expect(body.data.entries[0].GSI5PK).toBeUndefined();
  });

  test("queries journal and month prefix on GSI5", async () => {
    dynamoMock.on(QueryCommand).resolves({ Items: [] });

    const response = await handler(
      createEvent({ year: "2026", journalCode: "sales", month: "02" }),
    );
    const queryInput = dynamoMock.commandCalls(QueryCommand)[0].args[0].input;

    expect(response.statusCode).toBe(200);
    expect(queryInput.KeyConditionExpression).toBe(
      "GSI5PK = :pk AND begins_with(GSI5SK, :sk)",
    );
    expect(queryInput.ExpressionAttributeValues?.[":sk"].S).toBe(
      "JNL#SALES#DT#2026-02",
    );
  });

  test("rejects month without journalCode because GSI5 is journal-first", async () => {
    const response = await handler(createEvent({ year: "2026", month: "02" }));
    const body = parseResponse(response);

    expect(response.statusCode).toBe(400);
    expect(body.message.code).toBe("ERROR_INVALID_INPUT");
    expect(dynamoMock.commandCalls(QueryCommand)).toHaveLength(0);
  });
});
