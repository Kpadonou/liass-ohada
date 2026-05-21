import { createHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { LetteringService } from "@/lambda/shared/services/lettering-service";
import { z } from "zod";

const LineKeySchema = z.object({
  PK: z.string().min(1),
  SK: z.string().min(1),
});

const PostLetteringSchema = z.object({
  year: z.coerce.number().int().gte(1900),
  lineKeys: z.array(LineKeySchema).min(2),
  letteringCode: z.string().min(1),
});

export const handler = createHandler(
  PostLetteringSchema,
  async (data, { orgId, userId, i18n }) => {
    const result = await LetteringService.postLettering(orgId, userId, data);

    return {
      message: i18n.getMessage("SUCCESS_LETTERING_CONFIRMED"),
      ...result,
    };
  },
);
