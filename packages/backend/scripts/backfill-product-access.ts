import { readFileSync } from "node:fs";
import { ProductAccessService } from "../lambda/shared/services/product-access-service";
import type { ProductAccessCoverageReport } from "../lambda/shared/services/product-access-service";

export interface ProductAccessBackfillOptions {
  apply: boolean;
  orgIds: string[];
}

const readOrgIdsFile = (filePath: string): string[] => {
  const contents = readFileSync(filePath, "utf8").trim();
  if (!contents) {
    return [];
  }

  if (contents.startsWith("[")) {
    const parsed = JSON.parse(contents) as unknown;
    if (
      !Array.isArray(parsed) ||
      parsed.some((value) => typeof value !== "string")
    ) {
      throw new Error(
        "--org-ids-file JSON must be an array of organization IDs.",
      );
    }
    return parsed;
  }

  return contents
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean);
};

export const parseProductAccessBackfillArgs = (
  args: string[],
): ProductAccessBackfillOptions => {
  const orgIds: string[] = [];
  let apply = false;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--apply") {
      apply = true;
      continue;
    }
    if (argument === "--org-id") {
      const orgId = args[index + 1];
      if (!orgId || orgId.startsWith("--")) {
        throw new Error("--org-id requires a value.");
      }
      orgIds.push(orgId);
      index += 1;
      continue;
    }
    if (argument === "--org-ids-file") {
      const filePath = args[index + 1];
      if (!filePath || filePath.startsWith("--")) {
        throw new Error("--org-ids-file requires a path.");
      }
      orgIds.push(...readOrgIdsFile(filePath));
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }

  const uniqueOrgIds = Array.from(
    new Set(orgIds.map((orgId) => orgId.trim()).filter(Boolean)),
  );
  if (uniqueOrgIds.length === 0) {
    throw new Error("Provide at least one --org-id or --org-ids-file.");
  }

  return { apply, orgIds: uniqueOrgIds };
};

export const runProductAccessBackfill = async (
  options: ProductAccessBackfillOptions,
): Promise<ProductAccessCoverageReport[]> => {
  const reports: ProductAccessCoverageReport[] = [];
  for (const orgId of options.orgIds) {
    if (options.apply) {
      const result =
        await ProductAccessService.provisionCompatibilityBaseline(orgId);
      console.info("[PRODUCT_ACCESS_BACKFILL]", {
        created: result.created,
        existing: result.existing,
        mode: "APPLY",
        orgId,
      });
    }

    const report =
      await ProductAccessService.inspectCompatibilityBaseline(orgId);
    console.info("[PRODUCT_ACCESS_COVERAGE]", {
      ...report,
      mode: options.apply ? "APPLY" : "DRY_RUN",
    });
    reports.push(report);
  }
  return reports;
};

if (require.main === module) {
  runProductAccessBackfill(
    parseProductAccessBackfillArgs(process.argv.slice(2)),
  ).catch((error) => {
    console.error("ProductAccess backfill failed.", error);
    process.exitCode = 1;
  });
}
