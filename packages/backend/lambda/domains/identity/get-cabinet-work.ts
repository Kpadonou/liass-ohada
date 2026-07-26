import { createCabinetHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { CabinetOperationsService } from "@/lambda/shared/services/cabinet-operations-service";
import { z } from "zod";

const GetCabinetWorkRequestSchema = z.object({ workId: z.string().min(1) }).strict();

export const handler = createCabinetHandler(
  GetCabinetWorkRequestSchema,
  async (data, context) =>
    CabinetOperationsService.getWork(
      {
        orgId: context.orgId,
        userId: context.userId,
        cabinetId: context.cabinetId,
        workspaceType: context.workspaceType,
      },
      data.workId,
    ),
);
