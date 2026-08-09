import {
  parseProductAccessBackfillArgs,
  runProductAccessBackfill,
} from "@/scripts/backfill-product-access";
import { ProductAccessService } from "@/lambda/shared/services/product-access-service";

describe("ProductAccess backfill", () => {
  afterEach(() => jest.restoreAllMocks());

  test("requires explicit organization IDs and defaults to dry-run", () => {
    expect(() => parseProductAccessBackfillArgs([])).toThrow(
      "Provide at least one",
    );
    expect(
      parseProductAccessBackfillArgs([
        "--org-id",
        "org-1",
        "--org-id",
        "org-1",
        "--org-id",
        "org-2",
      ]),
    ).toEqual({ apply: false, orgIds: ["org-1", "org-2"] });
  });

  test("does not write during dry-run", async () => {
    const provision = jest.spyOn(
      ProductAccessService,
      "provisionCompatibilityBaseline",
    );
    const inspect = jest
      .spyOn(ProductAccessService, "inspectCompatibilityBaseline")
      .mockResolvedValue({
        active: ["ACCOUNTING"],
        coverage: "COMPLETE",
        inactive: [],
        legacyPresent: ["PROJECTS", "TREASURY"],
        missing: [],
        orgId: "org-1",
      });
    jest.spyOn(console, "info").mockImplementation(() => undefined);

    await expect(
      runProductAccessBackfill({ apply: false, orgIds: ["org-1"] }),
    ).resolves.toEqual([
      expect.objectContaining({ coverage: "COMPLETE", orgId: "org-1" }),
    ]);
    expect(provision).not.toHaveBeenCalled();
    expect(inspect).toHaveBeenCalledWith("org-1");
  });

  test("provisions only explicitly supplied organizations with --apply", async () => {
    const provision = jest
      .spyOn(ProductAccessService, "provisionCompatibilityBaseline")
      .mockResolvedValue({
        created: ["ACCOUNTING"],
        existing: [],
      });
    jest.spyOn(console, "info").mockImplementation(() => undefined);
    jest
      .spyOn(ProductAccessService, "inspectCompatibilityBaseline")
      .mockImplementation(async (orgId) => ({
        active: ["ACCOUNTING"],
        coverage: "COMPLETE",
        inactive: [],
        legacyPresent: ["PROJECTS", "TREASURY"],
        missing: [],
        orgId,
      }));

    await runProductAccessBackfill({ apply: true, orgIds: ["org-1", "org-2"] });
    expect(provision.mock.calls).toEqual([["org-1"], ["org-2"]]);
  });
});
