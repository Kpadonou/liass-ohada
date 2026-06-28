import { z } from "zod";

export const ThirdPartyType = z.enum(["CUSTOMER", "SUPPLIER"]);
export const ThirdPartyStatus = z.enum(["ACTIVE", "INACTIVE"]);

export const ThirdPartyDtoSchema = z.object({
  thirdPartyId: z.string().min(1),
  code: z.string().trim().min(1).max(50),
  displayName: z.string().trim().min(1).max(255),
  type: ThirdPartyType,
  status: ThirdPartyStatus,
  email: z.string().email().optional(),
  phone: z.string().trim().min(1).max(50).optional(),
  address: z.string().trim().min(1).max(500).optional(),
  country: z.string().trim().min(2).max(100).optional(),
  taxIdentifier: z.string().trim().min(1).max(100).optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const CreateThirdPartyRequestSchema = ThirdPartyDtoSchema.pick({
  code: true,
  displayName: true,
  type: true,
  email: true,
  phone: true,
  address: true,
  country: true,
  taxIdentifier: true,
});

export const UpdateThirdPartyRequestSchema = CreateThirdPartyRequestSchema.omit({
  code: true,
  type: true,
})
  .partial()
  .strict()
  .refine((payload) => Object.keys(payload).length > 0, {
    message: "At least one third-party field is required",
  });

export const GetThirdPartyRequestSchema = z.object({
  thirdPartyId: z.string().min(1),
  type: ThirdPartyType,
});

export const ListThirdPartiesRequestSchema = z.object({
  type: ThirdPartyType,
  status: ThirdPartyStatus.optional(),
  codePrefix: z.string().trim().min(1).max(50).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100).optional(),
  cursor: z.string().optional(),
});

export const ThirdPartyResponseSchema = z.object({
  message: z.unknown().optional(),
  thirdParty: ThirdPartyDtoSchema,
});

export const ListThirdPartiesResponseSchema = z.object({
  message: z.unknown().optional(),
  data: z.object({
    items: z.array(ThirdPartyDtoSchema),
    nextCursor: z.string().optional(),
    hasMore: z.boolean(),
  }),
});

export type ThirdPartyTypeValue = z.infer<typeof ThirdPartyType>;
export type ThirdPartyStatusValue = z.infer<typeof ThirdPartyStatus>;
export type ThirdPartyDto = z.infer<typeof ThirdPartyDtoSchema>;
export type CreateThirdPartyRequest = z.infer<
  typeof CreateThirdPartyRequestSchema
>;
export type UpdateThirdPartyRequest = z.infer<
  typeof UpdateThirdPartyRequestSchema
>;
export type ListThirdPartiesRequest = z.infer<
  typeof ListThirdPartiesRequestSchema
>;
