import { allowAccountingProductAccess } from "@/test/helpers/product-access";
import { handler } from "@/lambda/domains/accounting/journals/get-journal-entries";
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

const createEvent = (options?: {
  year?: string;
  journalCode?: string;
  month?: string;
  limit?: number;
  cursor?: string;
}) => {
  const {
    year = "2026",
    journalCode = "VE",
    month,
    limit,
    cursor,
  } = options || {};

  return {
    version: "2.0",
    routeKey: "GET /journals/{journalCode}/entries",
    rawPath: `/journals/${journalCode}/entries`,
    rawQueryString: "",
    headers: {
      "accept-language": "fr",
      "x-org-id": "test-org",
    },
    queryStringParameters: {
      year,
      ...(month ? { month } : {}),
      ...(limit ? { limit: limit.toString() } : {}),
      ...(cursor ? { cursor } : {}),
    },
    pathParameters: journalCode ? { journalCode } : undefined,
    requestContext: {
      http: {
        method: "GET",
        path: `/journals/${journalCode}/entries`,
      },
      authorizer: {
        jwt: {
          claims: { sub: "user-123" },
          scopes: [],
        },
      },
    },
    isBase64Encoded: false,
  };
};

const parseResponse = (response: any) =>
  JSON.parse(typeof response === "string" ? response : response.body ?? "{}");

describe("journal-specific book handler", () => {
  beforeEach(() => {
    allowAccountingProductAccess();
    dynamoMock.reset();
    jest.clearAllMocks();
    jest
      .mocked(TenantAccessService.assertUserCanAccessOrg)
      .mockResolvedValue({ role: "ACCOUNTANT", workspaceType: "COMPANY" });
  });

  test("queries posted entries for the required journal without scanning", async () => {
    dynamoMock.on(QueryCommand).resolves({
      Items: [
        {
          PK: { S: "ORG#test-org#FY#2026" },
          SK: { S: "E#E-001" },
          GSI5PK: { S: "ORG#test-org#FY#2026" },
          GSI5SK: { S: "JNL#VE#DT#2026-01-15#E#E-001" },
          entityType: { S: "ENTRY" },
          entryId: { S: "E-001" },
          entryDate: { S: "2026-01-15" },
          journalCode: { S: "VE" },
          voucherNumber: { S: "FV-001" },
          label: { S: "Vente" },
          totalDebit: { N: "125000" },
          totalCredit: { N: "125000" },
          status: { S: "POSTED" },
        },
      ],
    });

    const response = await handler(createEvent({ month: "01" }));
    const body = parseResponse(response);

    expect(response.statusCode).toBe(200);
    expect(body.data.meta).toEqual({
      year: "2026",
      journalCode: "VE",
      month: "01",
    });
    expect(body.data.entries[0]).toEqual({
      entryId: "E-001",
      date: "2026-01-15",
      journalCode: "VE",
      reference: "FV-001",
      label: "Vente",
      totalDebit: 125000,
      totalCredit: 125000,
      status: "POSTED",
    });
    expect(body.data.entries[0].PK).toBeUndefined();

    const queryInput = dynamoMock.commandCalls(QueryCommand)[0].args[0].input;
    expect(queryInput.IndexName).toBe("GSI5");
    expect(queryInput.KeyConditionExpression).toContain(
      "begins_with(#sk, :skPrefix)",
    );
    expect(queryInput.FilterExpression).toBe("#status = :posted");
    expect(queryInput.ConsistentRead).toBeUndefined();
    expect(dynamoMock.commandCalls(ScanCommand)).toHaveLength(0);
  });

  test("paginates the journal-specific book", async () => {
    const lastEvaluatedKey = {
      GSI5PK: { S: "ORG#test-org#FY#2026" },
      GSI5SK: { S: "JNL#VE#DT#2026-01-15#E#E-001" },
      PK: { S: "ORG#test-org#FY#2026" },
      SK: { S: "E#E-001" },
    };

    dynamoMock
      .on(QueryCommand)
      .resolvesOnce({
        Items: [
          {
            entryId: { S: "E-001" },
            entryDate: { S: "2026-01-15" },
            journalCode: { S: "VE" },
            totalDebit: { N: "100" },
            totalCredit: { N: "100" },
            status: { S: "POSTED" },
          },
        ],
        LastEvaluatedKey: lastEvaluatedKey,
      })
      .resolvesOnce({
        Items: [
          {
            entryId: { S: "E-002" },
            entryDate: { S: "2026-01-20" },
            journalCode: { S: "VE" },
            totalDebit: { N: "200" },
            totalCredit: { N: "200" },
            status: { S: "POSTED" },
          },
        ],
      });

    const firstBody = parseResponse(
      await handler(createEvent({ limit: 1 })),
    );
    expect(firstBody.data.hasMore).toBe(true);

    const secondBody = parseResponse(
      await handler(
        createEvent({
          limit: 1,
          cursor: firstBody.data.nextCursor,
        }),
      ),
    );
    expect(secondBody.data.entries[0].entryId).toBe("E-002");
    expect(secondBody.data.hasMore).toBe(false);
    expect(
      dynamoMock.commandCalls(QueryCommand)[1].args[0].input.ExclusiveStartKey,
    ).toEqual(lastEvaluatedKey);
  });

  test("rejects a journal book request without journalCode", async () => {
    const response = await handler(createEvent({ journalCode: "" }));
    const body = parseResponse(response);

    expect(response.statusCode).toBe(400);
    expect(body.message.code).toBe("ERROR_INVALID_INPUT");
    expect(dynamoMock.commandCalls(QueryCommand)).toHaveLength(0);
  });
});
