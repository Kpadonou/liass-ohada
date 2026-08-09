import { ProductAccessRepository } from "@/lambda/shared/repositories/product-access-repository";
import {
  COMPATIBILITY_PRODUCT_BASELINE,
  ProductAccessService,
} from "@/lambda/shared/services/product-access-service";
import type { ProductAccess } from "@liass-ohada/shared/shared";
import type { PersistedProductAccess } from "@/lambda/shared/repositories/product-access-repository";

const access = (
  status: "ACTIVE" | "INACTIVE",
): ProductAccess => ({
  orgId: "org-123",
  productCode: "ACCOUNTING",
  status,
  createdAt: "2026-08-07T10:00:00.000Z",
  updatedAt: "2026-08-07T10:00:00.000Z",
});

const persistedAccess = (
  status: "ACTIVE" | "INACTIVE",
  productCode: PersistedProductAccess["productCode"],
): PersistedProductAccess => ({ ...access(status), productCode });

describe("ProductAccessService", () => {
  afterEach(() => jest.restoreAllMocks());

  test("owns the one compatibility baseline used for transaction provisioning", () => {
    expect(COMPATIBILITY_PRODUCT_BASELINE).toEqual(["ACCOUNTING"]);
    expect(
      ProductAccessService.buildCompatibilityBaselineWrites(
        "org-123",
        "2026-08-07T10:00:00.000Z",
      ),
    ).toHaveLength(1);
  });

  test("exposes only canonical top-level ProductAccess", async () => {
    jest.spyOn(ProductAccessRepository, "listProductAccess").mockResolvedValue([
      persistedAccess("ACTIVE", "ACCOUNTING"),
      persistedAccess("ACTIVE", "PROJECTS"),
      persistedAccess("INACTIVE", "TREASURY"),
    ]);

    await expect(
      ProductAccessService.listProductAccess("org-123"),
    ).resolves.toEqual([access("ACTIVE")]);
  });

  test("allows ACTIVE access and rejects missing or INACTIVE access", async () => {
    const get = jest.spyOn(ProductAccessRepository, "getProductAccess");
    get.mockResolvedValueOnce(access("ACTIVE"));
    await expect(
      ProductAccessService.requireActiveProductAccess({
        action: "GET /test",
        orgId: "org-123",
        productCode: "ACCOUNTING",
      }),
    ).resolves.toMatchObject({ status: "ACTIVE" });

    jest.spyOn(console, "warn").mockImplementation(() => undefined);
    get.mockResolvedValueOnce(access("INACTIVE"));
    await expect(
      ProductAccessService.requireActiveProductAccess({
        action: "GET /test",
        orgId: "org-123",
        productCode: "ACCOUNTING",
      }),
    ).rejects.toMatchObject({
      messageCode: "PRODUCT_ACCESS_REQUIRED",
      statusCode: 403,
    });
    expect(console.warn).toHaveBeenCalledWith(
      "[PRODUCT_ACCESS_AUTHORIZATION_DENIED]",
      expect.objectContaining({ reason: "INACTIVE" }),
    );

    get.mockResolvedValueOnce(null);
    await expect(
      ProductAccessService.requireActiveProductAccess({
        action: "GET /test",
        orgId: "org-123",
        productCode: "ACCOUNTING",
      }),
    ).rejects.toMatchObject({ messageCode: "PRODUCT_ACCESS_REQUIRED" });
    expect(console.warn).toHaveBeenCalledWith(
      "[PRODUCT_ACCESS_AUTHORIZATION_DENIED]",
      expect.objectContaining({
        action: "GET /test",
        orgId: "org-123",
        productCode: "ACCOUNTING",
        reason: "MISSING",
      }),
    );
  });

  test("never treats legacy module rows as canonical Accounting entitlement", async () => {
    const get = jest
      .spyOn(ProductAccessRepository, "getProductAccess")
      .mockResolvedValue(null);

    await expect(
      ProductAccessService.requireActiveProductAccess({
        action: "GET /accounts",
        orgId: "org-123",
        productCode: "ACCOUNTING",
      }),
    ).rejects.toMatchObject({ messageCode: "PRODUCT_ACCESS_REQUIRED" });
    expect(get).toHaveBeenCalledWith("org-123", "ACCOUNTING");
  });

  test("rejects invalid product codes before repository access", async () => {
    const get = jest.spyOn(ProductAccessRepository, "getProductAccess");
    await expect(
      ProductAccessService.requireActiveProductAccess({
        action: "GET /test",
        orgId: "org-123",
        productCode: "RESTAURANTS" as never,
      }),
    ).rejects.toMatchObject({ name: "ZodError" });
    expect(get).not.toHaveBeenCalled();
  });

  test("classifies complete, partial, and missing baseline coverage", async () => {
    const list = jest.spyOn(ProductAccessRepository, "listProductAccess");
    list.mockResolvedValueOnce([
      persistedAccess("ACTIVE", "ACCOUNTING"),
      persistedAccess("INACTIVE", "PROJECTS"),
      persistedAccess("ACTIVE", "TREASURY"),
    ]);
    await expect(
      ProductAccessService.inspectCompatibilityBaseline("org-123"),
    ).resolves.toMatchObject({
      active: ["ACCOUNTING"],
      coverage: "COMPLETE",
      inactive: [],
      legacyPresent: ["PROJECTS", "TREASURY"],
      missing: [],
    });

    list.mockResolvedValueOnce([persistedAccess("INACTIVE", "ACCOUNTING")]);
    await expect(
      ProductAccessService.inspectCompatibilityBaseline("org-123"),
    ).resolves.toMatchObject({
      coverage: "COMPLETE",
      inactive: ["ACCOUNTING"],
      missing: [],
    });

    list.mockResolvedValueOnce([]);
    await expect(
      ProductAccessService.inspectCompatibilityBaseline("org-123"),
    ).resolves.toMatchObject({ coverage: "MISSING" });
  });

  test("creates every missing baseline item", async () => {
    jest.spyOn(ProductAccessRepository, "putIfAbsent").mockResolvedValue(true);

    await expect(
      ProductAccessService.provisionCompatibilityBaseline(
        "org-123",
        "2026-08-07T10:00:00.000Z",
      ),
    ).resolves.toEqual({
      created: ["ACCOUNTING"],
      existing: [],
    });
  });

  test("is idempotent and preserves an existing inactive row", async () => {
    const put = jest
      .spyOn(ProductAccessRepository, "putIfAbsent")
      .mockResolvedValue(false);

    await expect(
      ProductAccessService.provisionCompatibilityBaseline(
        "org-123",
        "2026-08-07T10:00:00.000Z",
      ),
    ).resolves.toEqual({
      created: [],
      existing: ["ACCOUNTING"],
    });
    expect(put.mock.calls[0][0]).toMatchObject({
      productCode: "ACCOUNTING",
      status: "ACTIVE",
    });
    expect(put).toHaveBeenCalledTimes(1);
  });

  test("completes a partial baseline without overwriting existing rows", async () => {
    jest
      .spyOn(ProductAccessRepository, "putIfAbsent")
      .mockResolvedValueOnce(false);

    await expect(
      ProductAccessService.provisionCompatibilityBaseline(
        "org-123",
        "2026-08-07T10:00:00.000Z",
      ),
    ).resolves.toEqual({
      created: [],
      existing: ["ACCOUNTING"],
    });
  });
});
