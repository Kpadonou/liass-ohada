import { PutBeninFiscalProfileRequestSchema } from "@liass-ohada/shared/fiscal-compliance";
import { createHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { FiscalService } from "../core/fiscal-service";

export const handler = createHandler(
  PutBeninFiscalProfileRequestSchema,
  async (input, { orgId, userId, i18n }) => ({
    message: i18n.getMessage("SUCCESS_FISCAL_LOCAL_OPERATION"),
    data: await FiscalService.putProfile(orgId, userId, input),
  }),
  { action: "PUT /fiscal-compliance/benin/profile", permission: "FISCAL_COMPLIANCE_WRITE", productCode: "SALES" },
);
