import { ReviseFiscalCertificationRequestSchema } from "@liass-ohada/shared/fiscal-compliance";
import { createHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { FiscalService } from "../core/fiscal-service";

export const handler = createHandler(
  ReviseFiscalCertificationRequestSchema,
  async (input, { orgId, userId, i18n }) => ({
    message: i18n.getMessage("SUCCESS_FISCAL_LOCAL_OPERATION"),
    data: await FiscalService.revise(orgId, userId, input),
  }),
  { action: "PATCH /fiscal-compliance/certifications/sources/{sourceDocumentType}/{sourceDocumentId}/preparation", permission: "FISCAL_COMPLIANCE_WRITE", productCode: "SALES" },
);
