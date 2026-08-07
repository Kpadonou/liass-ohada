import { ProductAccessRepository } from "@/lambda/shared/repositories/product-access-repository";
import { ProductAccessService } from "@/lambda/shared/services/product-access-service";

describe("ProductAccessService compatibility baseline", () => {
  afterEach(() => jest.restoreAllMocks());

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
