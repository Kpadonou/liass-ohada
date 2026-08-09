import { ProductAccessService } from "@/lambda/shared/services/product-access-service";

export const allowAccountingProductAccess = () =>
  jest
    .spyOn(ProductAccessService, "requireActiveProductAccess")
    .mockImplementation(async ({ orgId }) => ({
      orgId,
      productCode: "ACCOUNTING",
      status: "ACTIVE",
      createdAt: "2026-08-07T10:00:00.000Z",
      updatedAt: "2026-08-07T10:00:00.000Z",
    }));
