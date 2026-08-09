import { allowAccountingProductAccess } from "@/test/helpers/product-access";
import { handler } from "@/lambda/domains/accounting/entries/post-entry";
import { AppError } from "@/lambda/shared/app-error";
import { LedgerService } from "@/lambda/shared/services/ledger-service";
import { ProductAccessService } from "@/lambda/shared/services/product-access-service";
import { TenantAccessService } from "@/lambda/shared/services/tenant-access-service";

jest.mock("@/lambda/shared/services/ledger-service", () => ({
  LedgerService: {
    postEntry: jest.fn(),
  },
}));

jest.mock("@/lambda/shared/services/tenant-access-service", () => ({
  TenantAccessService: {
    assertUserCanAccessOrg: jest.fn(),
  },
}));

const createEvent = (claims: Record<string, string> = {}) => ({
  version: "2.0",
  routeKey: "POST /entries",
  rawPath: "/entries",
  rawQueryString: "",
  headers: { "accept-language": "en", "x-org-id": "test-org" },
  requestContext: {
    accountId: "123456789012",
    apiId: "api-id",
    domainName: "localhost",
    domainPrefix: "localhost",
    http: {
      method: "POST",
      path: "/entries",
      protocol: "HTTP/1.1",
      sourceIp: "127.0.0.1",
      userAgent: "jest",
    },
    requestId: "req-id",
    routeKey: "POST /entries",
    stage: "test",
    time: "01/Jan/1970:00:00:00 +0000",
    timeEpoch: 0,
    authorizer: {
      jwt: {
        claims,
        scopes: [],
      },
    },
  },
  body: JSON.stringify({
    year: 2026,
    entryDate: "2026-01-15",
    journalCode: "OD",
    label: "Test entry",
    lines: [
      { accountId: "41100000", debit: 100, credit: 0 },
      { accountId: "70100000", debit: 0, credit: 100 },
    ],
  }),
  isBase64Encoded: false,
});

describe("post-entry handler", () => {
  beforeEach(() => {
    allowAccountingProductAccess();
    jest.clearAllMocks();
    jest
      .mocked(TenantAccessService.assertUserCanAccessOrg)
      .mockResolvedValue({ role: "ACCOUNTANT", workspaceType: "COMPANY" });
  });

  test("delegates posting to LedgerService with tenant context", async () => {
    jest
      .mocked(LedgerService.postEntry)
      .mockResolvedValue({ entryId: "E-test" });

    const response = await handler(
      createEvent({ sub: "user-123" }) as any,
    );
    const body = JSON.parse(response.body);

    expect(response.statusCode).toBe(200);
    expect(body.entryId).toBe("E-test");
    expect(LedgerService.postEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: "test-org",
        userId: "user-123",
      }),
    );
  });

  test("rejects requests without user identity", async () => {
    const response = await handler(createEvent({}) as any);
    const body = JSON.parse(response.body);

    expect(response.statusCode).toBe(401);
    expect(body.message.code).toBe("ERROR_MISSING_USER_ID");
    expect(LedgerService.postEntry).not.toHaveBeenCalled();
  });

  test("does not start Accounting posting when ACCOUNTING ProductAccess is unavailable", async () => {
    jest
      .mocked(ProductAccessService.requireActiveProductAccess)
      .mockRejectedValueOnce(new AppError(403, "PRODUCT_ACCESS_REQUIRED"));

    const response = await handler(createEvent({ sub: "user-123" }) as any);

    expect(response.statusCode).toBe(403);
    expect(JSON.parse(response.body).error.code).toBe(
      "PRODUCT_ACCESS_REQUIRED",
    );
    expect(LedgerService.postEntry).not.toHaveBeenCalled();
  });
});
