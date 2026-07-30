import { handler as getHandler } from "@/lambda/domains/identity/get-cabinet-settings";
import { handler as updateHandler } from "@/lambda/domains/identity/update-cabinet-settings";
import { CabinetSettingsService } from "@/lambda/shared/services/cabinet-settings-service";
import { TenantAccessService } from "@/lambda/shared/services/tenant-access-service";
import { AppError } from "@/lambda/shared/app-error";

jest.mock("@/lambda/shared/services/cabinet-settings-service", () => ({
  CabinetSettingsService: {
    getSettings: jest.fn(),
    updateSettings: jest.fn(),
  },
}));
jest.mock("@/lambda/shared/services/tenant-access-service", () => ({
  TenantAccessService: { assertUserCanAccessOrg: jest.fn() },
}));

const response = {
  cabinetOrgId: "org-cabinet",
  organizationName: "Cabinet Kora",
  country: "BJ",
  contact: {},
  address: {},
  preferredLanguage: "fr",
  defaults: { country: "BJ", accountingFramework: "SYSCOHADA_REVISED" },
  version: 1,
} as const;

const event = (
  method: "GET" | "PATCH",
  body?: Record<string, unknown>,
  headers: Record<string, string> = {
    "accept-language": "en",
    "x-org-id": "org-cabinet",
  },
) => ({
  version: "2.0",
  routeKey: `${method} /cabinet/settings`,
  rawPath: "/cabinet/settings",
  rawQueryString: "",
  headers,
  requestContext: {
    http: {
      method,
      path: "/cabinet/settings",
      protocol: "HTTP/1.1",
      sourceIp: "127.0.0.1",
      userAgent: "jest",
    },
    authorizer: { jwt: { claims: { sub: "admin-2" }, scopes: [] } },
  },
  body: body ? JSON.stringify(body) : undefined,
  isBase64Encoded: false,
});

describe("Cabinet settings handlers", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(TenantAccessService.assertUserCanAccessOrg).mockResolvedValue({
      role: "MEMBER",
      cabinetRole: "CABINET_ADMIN",
      cabinetId: "cab-1",
      workspaceType: "ACCOUNTING_FIRM",
    });
  });

  test("GET uses CABINET context and returns the composed response", async () => {
    jest.mocked(CabinetSettingsService.getSettings).mockResolvedValue(response);
    const result = await getHandler(event("GET") as never);
    expect(result.statusCode).toBe(200);
    expect(CabinetSettingsService.getSettings).toHaveBeenCalledWith({
      orgId: "org-cabinet",
      userId: "admin-2",
      cabinetId: "cab-1",
      workspaceType: "ACCOUNTING_FIRM",
      cabinetRole: "CABINET_ADMIN",
    });
  });

  test("PATCH passes only strict validated fields", async () => {
    jest
      .mocked(CabinetSettingsService.updateSettings)
      .mockResolvedValue({ ...response, preferredLanguage: "en", version: 2 });
    const result = await updateHandler(
      event("PATCH", { expectedVersion: 1, preferredLanguage: "en" }) as never,
    );
    expect(result.statusCode).toBe(200);
    expect(CabinetSettingsService.updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: "org-cabinet", userId: "admin-2" }),
      { expectedVersion: 1, preferredLanguage: "en" },
    );
  });

  test("rejects protected and onboarding fields before mutation", async () => {
    const result = await updateHandler(
      event("PATCH", {
        expectedVersion: 1,
        ownerUserId: "attacker",
        onboardingSteps: [],
      }) as never,
    );
    expect(result.statusCode).toBe(400);
    expect(CabinetSettingsService.updateSettings).not.toHaveBeenCalled();
  });

  test("rejects a direct COMPANY workspace", async () => {
    jest.mocked(TenantAccessService.assertUserCanAccessOrg).mockResolvedValue({
      workspaceType: "COMPANY",
    });
    const result = await getHandler(event("GET") as never);
    expect(result.statusCode).toBe(403);
    expect(CabinetSettingsService.getSettings).not.toHaveBeenCalled();
  });

  test("returns the stable conflict envelope", async () => {
    jest
      .mocked(CabinetSettingsService.updateSettings)
      .mockRejectedValue(
        new AppError(409, "CABINET_SETTINGS_UPDATE_CONFLICT"),
      );
    const result = await updateHandler(
      event("PATCH", { expectedVersion: 1, preferredLanguage: "en" }) as never,
    );
    expect(result.statusCode).toBe(409);
    expect(JSON.parse(result.body).error.code).toBe(
      "CABINET_SETTINGS_UPDATE_CONFLICT",
    );
  });
});
