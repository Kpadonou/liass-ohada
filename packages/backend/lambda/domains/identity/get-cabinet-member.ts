import { createCabinetHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { CabinetTeamService } from "@/lambda/shared/services/cabinet-team-service";
import { z } from "zod";

export const handler = createCabinetHandler(
  z.object({ memberUserId: z.string().min(1) }).strict(),
  (data, context) =>
    CabinetTeamService.getMember(context, data.memberUserId),
);
