import { createHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { ThirdPartyService } from "@/lambda/shared/services/third-party-service";
import {
  ThirdPartyType,
} from "@liass-ohada/shared/accounting";
import { z } from "zod";

const UpdateThirdPartyRouteSchema = z
  .object({
    thirdPartyId: z.string().min(1),
    type: ThirdPartyType,
    displayName: z.string().trim().min(1).max(255).optional(),
    email: z.string().email().optional(),
    phone: z.string().trim().min(1).max(50).optional(),
    address: z.string().trim().min(1).max(500).optional(),
    country: z.string().trim().min(2).max(100).optional(),
    taxIdentifier: z.string().trim().min(1).max(100).optional(),
  })
  .strict()
  .refine(
    (payload) =>
      Object.keys(payload).some(
        (field) => field !== "thirdPartyId" && field !== "type",
      ),
    { message: "At least one third-party field is required" },
  );

export const handler = createHandler(
  UpdateThirdPartyRouteSchema,
  async (data, { orgId, i18n }) => {
    const { thirdPartyId, type, ...updates } = data;
    return {
      message: i18n.getMessage("SUCCESS_THIRD_PARTY_UPDATED"),
      thirdParty: await ThirdPartyService.update(
        orgId,
        type,
        thirdPartyId,
        updates,
      ),
    };
  },
);
