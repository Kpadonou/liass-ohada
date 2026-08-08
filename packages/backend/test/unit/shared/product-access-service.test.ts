import { ProductAccessRepository } from "@/lambda/shared/repositories/product-access-repository";
import {
  COMPATIBILITY_PRODUCT_BASELINE,
  ProductAccessService,
} from "@/lambda/shared/services/product-access-service";
import type { ProductCode } from "@liass-ohada/shared/shared";

const access = (
  status: "ACTIVE" | "INACTIVE",
  productCode: ProductCode = "ACCOUNTING",
) => ({
  orgId: "org-123",
  productCode,
  status,
  createdAt: "2026-08-07T10:00:00.000Z",
  updatedAt: "2026-08-07T10:00:00.000Z",
});

describe("ProductAccessService", () => {
  afterEach(() => jest.restoreAllMocks());

  test("owns the one compatibility baseline used for transaction provisioning", () => {
    expect(COMPATIBILITY_PRODUCT_BASELINE).toEqual([
      "ACCOUNTING",
      "PROJECTS",
      "TREASURY",
    ]);
    expect(
      ProductAccessService.buildCompatibilityBaselineWrites(
        "org-123",
        "2026-08-07T10:00:00.000Z",
      ),
    ).toHaveLength(3);
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
      access("ACTIVE", "ACCOUNTING"),
      access("INACTIVE", "PROJECTS"),
      access("ACTIVE", "TREASURY"),
    ]);
    await expect(
      ProductAccessService.inspectCompatibilityBaseline("org-123"),
    ).resolves.toMatchObject({
      active: ["ACCOUNTING", "TREASURY"],
      coverage: "COMPLETE",
      inactive: ["PROJECTS"],
      missing: [],
    });

    list.mockResolvedValueOnce([access("ACTIVE", "ACCOUNTING")]);
    await expect(
      ProductAccessService.inspectCompatibilityBaseline("org-123"),
    ).resolves.toMatchObject({
      coverage: "PARTIAL",
      missing: ["PROJECTS", "TREASURY"],
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
      created: ["ACCOUNTING", "PROJECTS", "TREASURY"],
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
      existing: ["ACCOUNTING", "PROJECTS", "TREASURY"],
    });
    expect(put.mock.calls[0][0]).toMatchObject({
      productCode: "ACCOUNTING",
      status: "ACTIVE",
    });
    expect(put).toHaveBeenCalledTimes(3);
  });

  test("completes a partial baseline without overwriting existing rows", async () => {
    jest
      .spyOn(ProductAccessRepository, "putIfAbsent")
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true);

    await expect(
      ProductAccessService.provisionCompatibilityBaseline(
        "org-123",
        "2026-08-07T10:00:00.000Z",
      ),
    ).resolves.toEqual({
      created: ["PROJECTS", "TREASURY"],
      existing: ["ACCOUNTING"],
    });
  });
});
