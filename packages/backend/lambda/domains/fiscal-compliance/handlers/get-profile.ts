import { z } from "zod";
import { createHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { FiscalService } from "../core/fiscal-service";

export const handler = createHandler(
  z.object({}).strict(),
  async (input, { orgId, userId, i18n }) => ({
    message: i18n.getMessage("SUCCESS_FISCAL_LOCAL_OPERATION"),
    data: await FiscalService.getProfile(orgId),
  }),
  { action: "GET /fiscal-compliance/benin/profile", permission: "FISCAL_COMPLIANCE_READ", productCode: "SALES" },
);
