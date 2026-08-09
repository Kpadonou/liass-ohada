import {
  PRODUCT_CODES,
  ProductAccess,
  ProductCode,
  ProductCodeSchema,
} from "@liass-ohada/shared/shared";
import type { TransactWriteItem } from "@aws-sdk/client-dynamodb";
import { z } from "zod";
import { AppError } from "../app-error";
import { ProductAccessRepository } from "../repositories/product-access-repository";
import type { PersistedProductCode } from "../repositories/product-access-repository";

const OrganizationIdSchema = z.string().min(1);

export const COMPATIBILITY_PRODUCT_BASELINE: readonly ProductCode[] =
  PRODUCT_CODES;

export type ProductAccessCoverage = "COMPLETE" | "PARTIAL" | "MISSING";

export interface ProductAccessCoverageReport {
  active: ProductCode[];
  coverage: ProductAccessCoverage;
  inactive: ProductCode[];
  missing: ProductCode[];
  legacyPresent: Exclude<PersistedProductCode, ProductCode>[];
  orgId: string;
}

export class ProductAccessService {
  static buildCompatibilityBaselineItems(
    orgId: string,
    timestamp: string,
  ) {
    const validatedOrgId = OrganizationIdSchema.parse(orgId);
    return COMPATIBILITY_PRODUCT_BASELINE.map((productCode) =>
      ProductAccessRepository.buildItem({
        orgId: validatedOrgId,
        productCode,
        status: "ACTIVE",
        timestamp,
      }),
    );
  }

  static buildCompatibilityBaselineWrites(
    orgId: string,
    timestamp: string,
  ): TransactWriteItem[] {
    return this.buildCompatibilityBaselineItems(orgId, timestamp).map((item) =>
      ProductAccessRepository.buildPutIfAbsentTransaction(item),
    );
  }

  static async getProductAccess(
    orgId: string,
    productCode: ProductCode,
  ): Promise<ProductAccess | null> {
    return ProductAccessRepository.getProductAccess(
      OrganizationIdSchema.parse(orgId),
      ProductCodeSchema.parse(productCode),
    );
  }

  static async listProductAccess(orgId: string): Promise<ProductAccess[]> {
    const persisted = await ProductAccessRepository.listProductAccess(
      OrganizationIdSchema.parse(orgId),
    );
    return persisted.flatMap((access) => {
      const productCode = ProductCodeSchema.safeParse(access.productCode);
      return productCode.success
        ? [
            {
              ...access,
              productCode: productCode.data,
            },
          ]
        : [];
    });
  }

  static async requireActiveProductAccess(input: {
    action: string;
    orgId: string;
    productCode: ProductCode;
  }): Promise<ProductAccess> {
    const action = z.string().min(1).parse(input.action);
    const orgId = OrganizationIdSchema.parse(input.orgId);
    const productCode = ProductCodeSchema.parse(input.productCode);
    const productAccess = await ProductAccessRepository.getProductAccess(
      orgId,
      productCode,
    );

    if (!productAccess || productAccess.status !== "ACTIVE") {
      console.warn("[PRODUCT_ACCESS_AUTHORIZATION_DENIED]", {
        action,
        event: "PRODUCT_ACCESS_DENIED",
        orgId,
        productCode,
        reason: productAccess ? "INACTIVE" : "MISSING",
      });
      throw new AppError(403, "PRODUCT_ACCESS_REQUIRED");
    }

    return productAccess;
  }

  static async inspectCompatibilityBaseline(
    orgId: string,
  ): Promise<ProductAccessCoverageReport> {
    const validatedOrgId = OrganizationIdSchema.parse(orgId);
    const accessByProduct = new Map(
      (await ProductAccessRepository.listProductAccess(validatedOrgId)).map(
        (access) => [access.productCode, access],
      ),
    );
    const legacyPresent = Array.from(accessByProduct.keys()).filter(
      (productCode): productCode is Exclude<PersistedProductCode, ProductCode> =>
        !ProductCodeSchema.safeParse(productCode).success,
    );
    const active: ProductCode[] = [];
    const inactive: ProductCode[] = [];
    const missing: ProductCode[] = [];

    for (const productCode of COMPATIBILITY_PRODUCT_BASELINE) {
      const access = accessByProduct.get(productCode);
      if (!access) {
        missing.push(productCode);
      } else if (access.status === "ACTIVE") {
        active.push(productCode);
      } else {
        inactive.push(productCode);
      }
    }

    return {
      active,
      coverage:
        missing.length === COMPATIBILITY_PRODUCT_BASELINE.length
          ? "MISSING"
          : missing.length > 0
            ? "PARTIAL"
            : "COMPLETE",
      inactive,
      legacyPresent,
      missing,
      orgId: validatedOrgId,
    };
  }

  static async provisionCompatibilityBaseline(
    orgId: string,
    timestamp = new Date().toISOString(),
  ): Promise<{ created: ProductCode[]; existing: ProductCode[] }> {
    const validatedOrgId = OrganizationIdSchema.parse(orgId);
    const items = this.buildCompatibilityBaselineItems(
      validatedOrgId,
      timestamp,
    );
    const created: ProductCode[] = [];
    const existing: ProductCode[] = [];

    for (const item of items) {
      const wasCreated = await ProductAccessRepository.putIfAbsent(item);
      (wasCreated ? created : existing).push(item.productCode);
    }

    return { created, existing };
  }
}
