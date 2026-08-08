import { handler } from "@/lambda/domains/treasury/get-summary";
import { AppError } from "@/lambda/shared/app-error";
import { AccountingAuthorizationService } from "@/lambda/shared/services/accounting-authorization-service";
import { ProductAccessService } from "@/lambda/shared/services/product-access-service";
import { TreasuryService } from "@/lambda/shared/services/treasury-service";

jest.mock("@/lambda/shared/services/treasury-service", () => ({
  TreasuryService: { getSummary: jest.fn() },
}));

const event = {
  version: "2.0",
  routeKey: "GET /treasury/summary",
  rawPath: "/treasury/summary",
  rawQueryString: "",
  headers: { "accept-language": "en", "x-org-id": "org-123" },
  requestContext: {
    authorizer: { jwt: { claims: { sub: "user-123" }, scopes: [] } },
  },
  queryStringParameters: { year: "2026" },
  isBase64Encoded: false,
};

describe("GET /treasury/summary ProductAccess pilot", () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
    jest
      .spyOn(AccountingAuthorizationService, "resolveAccess")
      .mockResolvedValue({
        accessMode: "READ_WRITE",
        accessSource: "DIRECT",
        orgId: "org-123",
        workspaceOrgId: "org-123",
      });
    jest.mocked(TreasuryService.getSummary).mockResolvedValue({
      year: "2026",
      accountsCount: 0,
      totalInflows: 0,
      totalOutflows: 0,
      netCashFlow: 0,
      unreconciledStatementLines: 0,
      unreconciledMovements: 0,
    });
  });

  test("declares TREASURY and executes only after ACTIVE entitlement", async () => {
    const requireAccess = jest
      .spyOn(ProductAccessService, "requireActiveProductAccess")
      .mockResolvedValue({
        orgId: "org-123",
        productCode: "TREASURY",
        status: "ACTIVE",
        createdAt: "2026-08-07T10:00:00.000Z",
        updatedAt: "2026-08-07T10:00:00.000Z",
      });

    const response = await handler(event as any);

    expect(response.statusCode).toBe(200);
    expect(requireAccess).toHaveBeenCalledWith({
      action: "GET /treasury/summary",
      orgId: "org-123",
      productCode: "TREASURY",
    });
    expect(TreasuryService.getSummary).toHaveBeenCalledWith("org-123", "2026");
  });

  test("does not execute Treasury logic when entitlement is unavailable", async () => {
    jest
      .spyOn(ProductAccessService, "requireActiveProductAccess")
      .mockRejectedValue(new AppError(403, "PRODUCT_ACCESS_REQUIRED"));

    const response = await handler(event as any);

    expect(response.statusCode).toBe(403);
    expect(JSON.parse(response.body).error.code).toBe(
      "PRODUCT_ACCESS_REQUIRED",
    );
    expect(TreasuryService.getSummary).not.toHaveBeenCalled();
  });
});
