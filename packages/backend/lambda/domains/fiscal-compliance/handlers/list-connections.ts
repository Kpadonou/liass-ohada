import { ListFiscalConnectionsRequestSchema } from "@liass-ohada/shared/fiscal-compliance";
import { createHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { FiscalService } from "../core/fiscal-service";

export const handler = createHandler(
  ListFiscalConnectionsRequestSchema,
  async (input, { orgId, userId, i18n }) => ({
    message: i18n.getMessage("SUCCESS_FISCAL_LOCAL_OPERATION"),
    data: await FiscalService.listConnections(orgId, input),
  }),
  { action: "GET /fiscal-compliance/benin/connections", permission: "FISCAL_COMPLIANCE_READ", productCode: "SALES" },
);
