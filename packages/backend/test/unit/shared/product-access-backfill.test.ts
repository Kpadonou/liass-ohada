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
    jest.spyOn(console, "info").mockImplementation(() => undefined);

    await runProductAccessBackfill({ apply: false, orgIds: ["org-1"] });
    expect(provision).not.toHaveBeenCalled();
  });

  test("provisions only explicitly supplied organizations with --apply", async () => {
    const provision = jest
      .spyOn(ProductAccessService, "provisionCompatibilityBaseline")
      .mockResolvedValue({
        created: ["PROJECTS"],
        existing: ["ACCOUNTING", "TREASURY"],
      });
    jest.spyOn(console, "info").mockImplementation(() => undefined);

    await runProductAccessBackfill({ apply: true, orgIds: ["org-1", "org-2"] });
    expect(provision.mock.calls).toEqual([["org-1"], ["org-2"]]);
  });
});
