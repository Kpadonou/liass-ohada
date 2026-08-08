import { handler } from "@/lambda/domains/treasury/get-summary";
import { handler as listAccountsHandler } from "@/lambda/domains/treasury/list-accounts";
import { AppError } from "@/lambda/shared/app-error";
import { AccountingAuthorizationService } from "@/lambda/shared/services/accounting-authorization-service";
import { DomainAuthorizationService } from "@/lambda/shared/services/domain-authorization-service";
import { ProductAccessService } from "@/lambda/shared/services/product-access-service";
import { TreasuryService } from "@/lambda/shared/services/treasury-service";

jest.mock("@/lambda/shared/services/treasury-service", () => ({
  TreasuryService: { getSummary: jest.fn(), listAccounts: jest.fn() },
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
  const originalPermission = process.env.ACCOUNTING_PERMISSION;

  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
    delete process.env.ACCOUNTING_PERMISSION;
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
    jest.mocked(TreasuryService.listAccounts).mockResolvedValue({
      accounts: [],
      count: 0,
      hasMore: false,
    });
  });

  afterAll(() => {
    process.env.ACCOUNTING_PERMISSION = originalPermission;
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
    const requirePermission = jest.spyOn(
      DomainAuthorizationService,
      "assertPermission",
    );

    const response = await handler(event as any);

    expect(response.statusCode).toBe(200);
    expect(requireAccess).toHaveBeenCalledWith({
      action: "GET /treasury/summary",
      orgId: "org-123",
      productCode: "TREASURY",
    });
    expect(requirePermission).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: "org-123" }),
      "TREASURY_READ",
    );
    expect(TreasuryService.getSummary).toHaveBeenCalledWith("org-123", "2026");
  });

  test("rejects a non-member before checking ProductAccess", async () => {
    jest
      .spyOn(AccountingAuthorizationService, "resolveAccess")
      .mockRejectedValue(new AppError(403, "ERROR_ORG_ACCESS_DENIED"));
    const requireAccess = jest.spyOn(
      ProductAccessService,
      "requireActiveProductAccess",
    );

    const response = await handler(event as any);

    expect(response.statusCode).toBe(403);
    expect(requireAccess).not.toHaveBeenCalled();
    expect(TreasuryService.getSummary).not.toHaveBeenCalled();
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

  test("does not accept a Projects permission for the Treasury pilot", async () => {
    jest
      .spyOn(AccountingAuthorizationService, "resolveAccess")
      .mockResolvedValue({
        accessMode: "READ_WRITE",
        accessSource: "DIRECT",
        orgId: "org-123",
        permissions: ["PROJECTS_READ"],
        workspaceOrgId: "org-123",
      });
    jest
      .spyOn(ProductAccessService, "requireActiveProductAccess")
      .mockResolvedValue({
        orgId: "org-123",
        productCode: "TREASURY",
        status: "ACTIVE",
        createdAt: "2026-08-07T10:00:00.000Z",
        updatedAt: "2026-08-07T10:00:00.000Z",
      });

    const response = await handler(event as any);

    expect(response.statusCode).toBe(403);
    expect(JSON.parse(response.body).error.code).toBe(
      "DOMAIN_PERMISSION_REQUIRED",
    );
    expect(TreasuryService.getSummary).not.toHaveBeenCalled();
  });

  test("leaves a permission-only Treasury route ProductAccess-non-enforcing", async () => {
    const requireAccess = jest.spyOn(
      ProductAccessService,
      "requireActiveProductAccess",
    );
    const requirePermission = jest.spyOn(
      DomainAuthorizationService,
      "assertPermission",
    );

    const response = await listAccountsHandler({
      ...event,
      routeKey: "GET /treasury/accounts",
      rawPath: "/treasury/accounts",
      queryStringParameters: undefined,
    } as any);

    expect(response.statusCode).toBe(200);
    expect(requireAccess).not.toHaveBeenCalled();
    expect(requirePermission).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: "org-123" }),
      "TREASURY_READ",
    );
    expect(TreasuryService.listAccounts).toHaveBeenCalledWith("org-123", {
      limit: 100,
    });
  });
});
