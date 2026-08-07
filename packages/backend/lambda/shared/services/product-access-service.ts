import {
  ProductAccess,
  ProductCode,
  ProductCodeSchema,
} from "@liass-ohada/shared/shared";
import { z } from "zod";
import { ProductAccessRepository } from "../repositories/product-access-repository";

const OrganizationIdSchema = z.string().min(1);

export class ProductAccessService {
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
    return ProductAccessRepository.listProductAccess(
      OrganizationIdSchema.parse(orgId),
    );
  }

  static async provisionCompatibilityBaseline(
    orgId: string,
    timestamp = new Date().toISOString(),
  ): Promise<{ created: ProductCode[]; existing: ProductCode[] }> {
    const validatedOrgId = OrganizationIdSchema.parse(orgId);
    const items = ProductAccessRepository.buildCompatibilityBaseline(
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
