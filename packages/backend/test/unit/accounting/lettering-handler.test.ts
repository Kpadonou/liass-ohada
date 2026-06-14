import { handler as cancelHandler } from "@/lambda/domains/accounting/lettering/cancel-lettering";
import { handler as postHandler } from "@/lambda/domains/accounting/lettering/post-lettering";
import { LetteringService } from "@/lambda/shared/services/lettering-service";
import { TenantAccessService } from "@/lambda/shared/services/tenant-access-service";

jest.mock("@/lambda/shared/services/lettering-service", () => ({
  LetteringService: {
    cancelLettering: jest.fn(),
    postLettering: jest.fn(),
  },
}));

jest.mock("@/lambda/shared/services/tenant-access-service", () => ({
  TenantAccessService: {
    assertUserCanAccessOrg: jest.fn(),
  },
}));

const createEvent = (body: Record<string, unknown>) => ({
  version: "2.0",
  routeKey: "POST /lettering",
  rawPath: "/lettering",
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
  isBase64Encoded: false,
});

const parseResponse = (response: any) => JSON.parse(response.body ?? "{}");

describe("lettering handlers", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest
      .mocked(TenantAccessService.assertUserCanAccessOrg)
      .mockResolvedValue({ role: "ACCOUNTANT" });
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
});
