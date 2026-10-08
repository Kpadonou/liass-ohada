import { FiscalSourceRequestSchema } from "@liass-ohada/shared/fiscal-compliance";
import { createHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { FiscalService } from "../core/fiscal-service";

export const handler = createHandler(
  FiscalSourceRequestSchema,
  async (input, { orgId, userId, i18n }) => ({
    message: i18n.getMessage("SUCCESS_FISCAL_LOCAL_OPERATION"),
    data: await FiscalService.getCertification(orgId, input),
  }),
  { action: "GET /fiscal-compliance/certifications/sources/{sourceDocumentType}/{sourceDocumentId}", permission: "FISCAL_COMPLIANCE_READ", productCode: "SALES" },
);
