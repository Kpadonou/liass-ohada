import { FiscalConnectionIdRequestSchema, UpdateBeninConnectionRequestSchema } from "@liass-ohada/shared/fiscal-compliance";
import { createHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { FiscalService } from "../core/fiscal-service";

export const handler = createHandler(
  UpdateBeninConnectionRequestSchema.extend(FiscalConnectionIdRequestSchema.shape).strict(),
  async (input, { orgId, userId, i18n }) => ({
    message: i18n.getMessage("SUCCESS_FISCAL_LOCAL_OPERATION"),
    data: await FiscalService.updateConnection(orgId, userId, { environment: input.environment, connectionId: input.connectionId }, (({ environment, connectionId, ...fields }) => fields)(input)),
  }),
  { action: "PATCH /fiscal-compliance/benin/connections/{connectionId}", permission: "FISCAL_COMPLIANCE_WRITE", productCode: "SALES" },
);
