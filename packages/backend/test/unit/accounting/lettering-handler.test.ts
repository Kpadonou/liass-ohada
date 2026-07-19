import { handler as cancelHandler } from "@/lambda/domains/accounting/lettering/cancel-lettering";
import { handler as cancelMatchHandler } from "@/lambda/domains/accounting/lettering/cancel-match";
import { handler as candidatesHandler } from "@/lambda/domains/accounting/lettering/get-candidates";
import { handler as createMatchHandler } from "@/lambda/domains/accounting/lettering/create-match";
import { handler as getMatchHandler } from "@/lambda/domains/accounting/lettering/get-match";
import { handler as postHandler } from "@/lambda/domains/accounting/lettering/post-lettering";
import { LetteringService } from "@/lambda/shared/services/lettering-service";
import { TenantAccessService } from "@/lambda/shared/services/tenant-access-service";

jest.mock("@/lambda/shared/services/lettering-service", () => ({
  LetteringService: {
    cancelLettering: jest.fn(),
    cancelMatch: jest.fn(),
    createManualMatch: jest.fn(),
    getMatch: jest.fn(),
    listCandidates: jest.fn(),
    postLettering: jest.fn(),
  },
}));

jest.mock("@/lambda/shared/services/tenant-access-service", () => ({
  TenantAccessService: {
    assertUserCanAccessOrg: jest.fn(),
  },
}));

const createEvent = (
  body: Record<string, unknown> = {},
  options: {
    method?: string;
    path?: string;
    queryStringParameters?: Record<string, string>;
    pathParameters?: Record<string, string>;
  } = {},
) => ({
  version: "2.0",
  routeKey: `${options.method ?? "POST"} ${options.path ?? "/lettering"}`,
  rawPath: options.path ?? "/lettering",
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
  body: JSON.stringify(body),
  queryStringParameters: options.queryStringParameters,
  pathParameters: options.pathParameters,
  isBase64Encoded: false,
});

const parseResponse = (response: any) => JSON.parse(response.body ?? "{}");

describe("lettering handlers", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest
      .mocked(TenantAccessService.assertUserCanAccessOrg)
      .mockResolvedValue({ role: "ACCOUNTANT", workspaceType: "COMPANY" });
  });

  test("posts lettering with business line references instead of PK/SK", async () => {
    jest.mocked(LetteringService.postLettering).mockResolvedValue({
      letteringCode: "A1",
      letteringStatus: "COMPLETE",
      remainingBalance: 0,
    });

    const body = {
      accountId: "41100000",
      thirdPartyId: "CUST-1",
      letteringCode: "A1",
      lines: [
        { year: 2026, entryId: "E-1", lineId: "L-1" },
        { year: 2026, entryId: "E-2", lineId: "L-2" },
      ],
    };
    const response = await postHandler(createEvent(body) as any);

    expect(response.statusCode).toBe(200);
    expect(LetteringService.postLettering).toHaveBeenCalledWith(
      "test-org",
      "user-123",
      body,
    );
  });

  test("rejects the old raw PK/SK lettering shape", async () => {
    const response = await postHandler(
      createEvent({
        year: 2026,
        letteringCode: "A1",
        lineKeys: [
          { PK: "ORG#test-org#FY#2026", SK: "L#1" },
          { PK: "ORG#test-org#FY#2026", SK: "L#2" },
        ],
      }) as any,
    );
    const body = parseResponse(response);

    expect(response.statusCode).toBe(400);
    expect(body.message.code).toBe("ERROR_INVALID_INPUT");
    expect(LetteringService.postLettering).not.toHaveBeenCalled();
  });

  test("cancels lettering with business line references", async () => {
    jest.mocked(LetteringService.cancelLettering).mockResolvedValue({
      linesProcessed: 1,
    });

    const body = {
      accountId: "41100000",
      thirdPartyId: "CUST-1",
      lines: [{ year: 2026, entryId: "E-1", lineId: "L-1" }],
    };
    const response = await cancelHandler(createEvent(body) as any);

    expect(response.statusCode).toBe(200);
    expect(LetteringService.cancelLettering).toHaveBeenCalledWith(
      "test-org",
      "user-123",
      body,
    );
  });

  test("lists Lot 5.2 candidates with shared query params", async () => {
    jest.mocked(LetteringService.listCandidates).mockResolvedValue({
      accountId: "41100000",
      accountCode: "41100000",
      thirdPartyId: "TP-1",
      thirdPartyType: "CUSTOMER",
      thirdPartyName: "Client A",
      lines: [],
      hasMore: false,
    });

    const response = await candidatesHandler(
      createEvent(
        {},
        {
          method: "GET",
          path: "/lettering/candidates",
          queryStringParameters: {
            fiscalYear: "2026",
            accountId: "41100000",
            thirdPartyId: "TP-1",
            thirdPartyType: "CUSTOMER",
          },
        },
      ) as any,
    );

    expect(response.statusCode).toBe(200);
    expect(LetteringService.listCandidates).toHaveBeenCalledWith("test-org", {
      fiscalYear: 2026,
      accountId: "41100000",
      thirdPartyId: "TP-1",
      thirdPartyType: "CUSTOMER",
      limit: 50,
    });
  });

  test("creates a Lot 5.2 lettering match", async () => {
    const match = {
      letteringId: "LM-1",
      fiscalYear: 2026,
      accountId: "41100000",
      accountCode: "41100000",
      thirdPartyId: "TP-1",
      thirdPartyType: "CUSTOMER" as const,
      status: "ACTIVE" as const,
      totalDebit: 1000,
      totalCredit: 1000,
      createdAt: "2026-03-15T10:00:00.000Z",
      createdBy: "user-123",
      allocations: [
        {
          entryId: "E-1",
          lineId: "L-1",
          accountingDate: "2026-03-15",
          journalCode: "SALES",
          debit: 1000,
          credit: 0,
          allocatedAmount: 1000,
        },
      ],
    };
    jest.mocked(LetteringService.createManualMatch).mockResolvedValue(match);

    const body = {
      fiscalYear: 2026,
      accountId: "41100000",
      thirdPartyId: "TP-1",
      thirdPartyType: "CUSTOMER",
      allocations: [
        { entryId: "E-1", lineId: "L-1", amount: 1000 },
        { entryId: "E-2", lineId: "L-2", amount: 1000 },
      ],
    };
    const response = await createMatchHandler(
      createEvent(body, {
        method: "POST",
        path: "/lettering/matches",
      }) as any,
    );

    expect(response.statusCode).toBe(200);
    expect(LetteringService.createManualMatch).toHaveBeenCalledWith(
      "test-org",
      "user-123",
      body,
    );
    expect(parseResponse(response).data).toMatchObject({
      letteringId: "LM-1",
    });
  });

  test("gets and cancels a Lot 5.2 lettering match by path id", async () => {
    jest.mocked(LetteringService.getMatch).mockResolvedValue({
      letteringId: "LM-1",
      fiscalYear: 2026,
      accountId: "41100000",
      thirdPartyId: "TP-1",
      thirdPartyType: "CUSTOMER",
      status: "ACTIVE",
      totalDebit: 1000,
      totalCredit: 1000,
      createdAt: "2026-03-15T10:00:00.000Z",
      allocations: [
        {
          entryId: "E-1",
          lineId: "L-1",
          accountingDate: "2026-03-15",
          journalCode: "SALES",
          debit: 1000,
          credit: 0,
          allocatedAmount: 1000,
        },
      ],
    });
    jest.mocked(LetteringService.cancelMatch).mockResolvedValue({
      letteringId: "LM-1",
      fiscalYear: 2026,
      accountId: "41100000",
      thirdPartyId: "TP-1",
      thirdPartyType: "CUSTOMER",
      status: "CANCELLED",
      totalDebit: 1000,
      totalCredit: 1000,
      createdAt: "2026-03-15T10:00:00.000Z",
      cancelledAt: "2026-03-15T10:05:00.000Z",
      allocations: [
        {
          entryId: "E-1",
          lineId: "L-1",
          accountingDate: "2026-03-15",
          journalCode: "SALES",
          debit: 1000,
          credit: 0,
          allocatedAmount: 1000,
        },
      ],
    });

    await getMatchHandler(
      createEvent(
        {},
        {
          method: "GET",
          path: "/lettering/matches/LM-1",
          pathParameters: { letteringId: "LM-1" },
          queryStringParameters: { fiscalYear: "2026" },
        },
      ) as any,
    );
    await cancelMatchHandler(
      createEvent(
        { fiscalYear: 2026, cancellationReason: "Erreur" },
        {
          method: "POST",
          path: "/lettering/matches/LM-1/cancel",
          pathParameters: { letteringId: "LM-1" },
        },
      ) as any,
    );

    expect(LetteringService.getMatch).toHaveBeenCalledWith(
      "test-org",
      2026,
      "LM-1",
    );
    expect(LetteringService.cancelMatch).toHaveBeenCalledWith(
      "test-org",
      "user-123",
      {
        fiscalYear: 2026,
        letteringId: "LM-1",
        cancellationReason: "Erreur",
      },
    );
  });
});
