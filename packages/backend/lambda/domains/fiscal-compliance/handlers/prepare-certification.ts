import { PrepareFiscalCertificationRequestSchema } from "@liass-ohada/shared/fiscal-compliance";
import { createHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { FiscalService } from "../core/fiscal-service";

export const handler = createHandler(
  PrepareFiscalCertificationRequestSchema,
  async (input, { orgId, userId, i18n }) => ({
    message: i18n.getMessage("SUCCESS_FISCAL_LOCAL_OPERATION"),
    data: await FiscalService.prepare(orgId, userId, input),
  }),
  { action: "POST /fiscal-compliance/certifications", permission: "FISCAL_COMPLIANCE_WRITE", productCode: "SALES" },
);
