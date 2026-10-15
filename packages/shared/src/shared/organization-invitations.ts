import { z } from "zod";
import { CabinetInvitationStatusSchema } from "./cabinet-team";

// Preserve the existing Platform invitation lifecycle, including CANCELLED terminology.
export const OrganizationInvitationStatusSchema = CabinetInvitationStatusSchema;
export const CreateOrganizationInvitationRequestSchema = z
  .object({
    clientRequestId: z.uuid(),
    email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
  })
  .strict();
export const OrganizationInvitationSummarySchema = z
  .object({
    invitationId: z.uuid(),
    email: z.email(),
    status: OrganizationInvitationStatusSchema,
    expiresAt: z.iso.datetime(),
  })
  .strict();
export const CreateOrganizationInvitationResponseSchema = z
  .object({
    invitation: OrganizationInvitationSummarySchema,
    invitationToken: z
      .string()
      .regex(/^[A-Za-z0-9_-]{43}$/)
      .optional(),
    deliveryMode: z.enum(["DEVELOPMENT_TOKEN", "UNAVAILABLE"]),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      (value.deliveryMode === "DEVELOPMENT_TOKEN") !==
      !!value.invitationToken
    )
      context.addIssue({
        code: "custom",
        path: ["deliveryMode"],
        message: "Invalid delivery state",
      });
  });
export const AcceptOrganizationInvitationRequestSchema = z
  .object({
    token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  })
  .strict();
export const AcceptOrganizationInvitationResponseSchema = z
  .object({
    organizationId: z.string().min(1),
    membershipStatus: z.literal("ACTIVE"),
  })
  .strict();
export type CreateOrganizationInvitationRequest = z.infer<
  typeof CreateOrganizationInvitationRequestSchema
>;
export type OrganizationInvitationSummary = z.infer<
  typeof OrganizationInvitationSummarySchema
>;
export type CreateOrganizationInvitationResponse = z.infer<
  typeof CreateOrganizationInvitationResponseSchema
>;
export type AcceptOrganizationInvitationResponse = z.infer<
  typeof AcceptOrganizationInvitationResponseSchema
>;
