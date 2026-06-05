import { createHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { LetteringService } from "@/lambda/shared/services/lettering-service";
import { z } from "zod";

const LineKeySchema = z.object({
  PK: z.string().min(1),
  SK: z.string().min(1),
});

const CancelLetteringSchema = z.object({
  lineKeys: z.array(LineKeySchema).min(1),
});

export const handler = createHandler(
  CancelLetteringSchema,
  async (data, { orgId, userId, i18n }) => {
    const result = await LetteringService.cancelLettering(
      orgId,
      userId,
      data.lineKeys,
    );

    return {
      message: i18n.getMessage("SUCCESS_UNLETTERING_COMPLETED"),
      ...result,
    };
  },
);
