import { z } from "zod";

export const CabinetRoleSchema = z.enum([
  "CABINET_ADMIN",
  "SUPERVISOR",
  "COLLABORATOR",
  "READER",
]);

export const OrganizationAccessStatusSchema = z.enum([
  "ACTIVE",
  "SUSPENDED",
  "REVOKED",
]);

export const CabinetMemberStatusSchema = OrganizationAccessStatusSchema;

export const CabinetInvitationStatusSchema = z.enum([
  "PENDING",
  "ACCEPTED",
  "EXPIRED",
  "CANCELLED",
]);

const CursorPageRequestShape = {
  limit: z.coerce.number().int().min(1).max(100).default(50).optional(),
  cursor: z.string().min(1).optional(),
};

const uniqueStringArray = (maximum: number) =>
  z
    .array(z.string().trim().min(1))
    .max(maximum)
    .superRefine((values, context) => {
      if (new Set(values).size !== values.length) {
        context.addIssue({
          code: "custom",
          message: "Dossier identifiers must be unique",
        });
      }
    });

export const CabinetMemberSchema = z
  .object({
    userId: z.string().min(1),
    cabinetRole: CabinetRoleSchema,
    status: CabinetMemberStatusSchema,
    displayName: z.string().min(1).optional(),
    email: z.string().email().optional(),
    joinedAt: z.string().datetime().optional(),
    invitedBy: z.string().min(1).optional(),
    createdAt: z.string().datetime().optional(),
    updatedAt: z.string().datetime(),
    updatedBy: z.string().min(1).optional(),
    isOwner: z.boolean().default(false),
  })
  .strict();

export const CabinetMemberSummarySchema = CabinetMemberSchema.pick({
  userId: true,
  cabinetRole: true,
  status: true,
  displayName: true,
  email: true,
  joinedAt: true,
    updatedAt: true,
    isOwner: true,
});

export const CabinetInvitationSchema = z
  .object({
    invitationId: z.string().min(1),
    email: z.string().email(),
    role: CabinetRoleSchema,
    status: CabinetInvitationStatusSchema,
    invitedBy: z.string().min(1),
    createdAt: z.string().datetime(),
    expiresAt: z.string().datetime(),
    acceptedAt: z.string().datetime().optional(),
    acceptedByUserId: z.string().min(1).optional(),
    cancelledAt: z.string().datetime().optional(),
    cancelledBy: z.string().min(1).optional(),
    initialDossierOrgIds: z.array(z.string().min(1)).max(20).default([]),
  })
  .strict();

export const CabinetInvitationSummarySchema = CabinetInvitationSchema;

export const CabinetDossierAssignmentSchema = z
  .object({
    userId: z.string().min(1),
    dossierOrgId: z.string().min(1),
    dossierDisplayName: z.string().min(1).optional(),
    assignedBy: z.string().min(1),
    assignedAt: z.string().datetime(),
  })
  .strict();

export const ListCabinetMembersRequestSchema = z
  .object({
    ...CursorPageRequestShape,
    role: CabinetRoleSchema.optional(),
    status: CabinetMemberStatusSchema.optional(),
  })
  .strict();

export const ListCabinetMembersResponseSchema = z
  .object({
    members: CabinetMemberSummarySchema.array(),
    nextCursor: z.string().optional(),
    hasMore: z.boolean().optional(),
  })
  .strict()
  .transform((value) => ({
    ...value,
    hasMore: value.hasMore ?? Boolean(value.nextCursor),
  }));

export const GetCabinetMemberResponseSchema = z
  .object({ member: CabinetMemberSchema })
  .strict();

export const UpdateCabinetMemberRoleRequestSchema = z
  .object({ role: CabinetRoleSchema })
  .strict();

export const UpdateCabinetMemberStatusRequestSchema = z
  .object({ status: CabinetMemberStatusSchema })
  .strict();

export const CreateCabinetInvitationRequestSchema = z
  .object({
    email: z.string().trim().email().transform((value) => value.toLowerCase()),
    role: CabinetRoleSchema,
    initialDossierOrgIds: uniqueStringArray(20).default([]),
  })
  .strict();

export const CreateCabinetInvitationResponseSchema = z
  .object({
    invitation: CabinetInvitationSchema,
    invitationToken: z.string().min(1).optional(),
    deliveryMode: z
      .enum(["DEVELOPMENT_TOKEN", "UNAVAILABLE"])
      .default("UNAVAILABLE"),
  })
  .strict();

export const ListCabinetInvitationsRequestSchema = z
  .object({
    ...CursorPageRequestShape,
    status: CabinetInvitationStatusSchema.optional(),
  })
  .strict();

export const ListCabinetInvitationsResponseSchema = z
  .object({
    invitations: CabinetInvitationSummarySchema.array(),
    nextCursor: z.string().optional(),
    hasMore: z.boolean().optional(),
  })
  .strict()
  .transform((value) => ({
    ...value,
    hasMore: value.hasMore ?? Boolean(value.nextCursor),
  }));

export const ResendCabinetInvitationResponseSchema =
  CreateCabinetInvitationResponseSchema;

export const CabinetInvitationResponseSchema = z
  .object({ invitation: CabinetInvitationSchema })
  .strict();

export const AcceptCabinetInvitationRequestSchema = z
  .object({ token: z.string().min(32).max(512) })
  .strict();

export const AcceptCabinetInvitationResponseSchema = z
  .object({
    member: CabinetMemberSchema,
    assignments: CabinetDossierAssignmentSchema.array(),
  })
  .strict();

export const ReplaceCabinetMemberAssignmentsRequestSchema = z
  .object({ dossierOrgIds: uniqueStringArray(50) })
  .strict();

export const ListCabinetMemberAssignmentsResponseSchema = z
  .object({ assignments: CabinetDossierAssignmentSchema.array() })
  .strict();

export const ListCabinetDossierMembersResponseSchema = z
  .object({ members: CabinetMemberSummarySchema.array() })
  .strict();

export const CabinetDossierAssignmentMutationResponseSchema = z
  .object({ assignment: CabinetDossierAssignmentSchema })
  .strict();

export type CabinetDossierAssignmentMutationResponse = z.infer<
  typeof CabinetDossierAssignmentMutationResponseSchema
>;

export type CabinetRole = z.infer<typeof CabinetRoleSchema>;
export type OrganizationAccessStatus = z.infer<
  typeof OrganizationAccessStatusSchema
>;
export type CabinetMemberStatus = z.infer<typeof CabinetMemberStatusSchema>;
export type CabinetInvitationStatus = z.infer<
  typeof CabinetInvitationStatusSchema
>;
export type CabinetMember = z.infer<typeof CabinetMemberSchema>;
export type CabinetMemberSummary = z.infer<typeof CabinetMemberSummarySchema>;
export type CabinetInvitation = z.infer<typeof CabinetInvitationSchema>;
export type CabinetInvitationSummary = z.infer<
  typeof CabinetInvitationSummarySchema
>;
export type CabinetDossierAssignment = z.infer<
  typeof CabinetDossierAssignmentSchema
>;
export type ListCabinetMembersRequest = z.infer<
  typeof ListCabinetMembersRequestSchema
>;
export type UpdateCabinetMemberRoleRequest = z.infer<
  typeof UpdateCabinetMemberRoleRequestSchema
>;
export type UpdateCabinetMemberStatusRequest = z.infer<
  typeof UpdateCabinetMemberStatusRequestSchema
>;
export type CreateCabinetInvitationRequest = z.infer<
  typeof CreateCabinetInvitationRequestSchema
>;
export type ListCabinetInvitationsRequest = z.infer<
  typeof ListCabinetInvitationsRequestSchema
>;
export type AcceptCabinetInvitationRequest = z.infer<
  typeof AcceptCabinetInvitationRequestSchema
>;
export type ReplaceCabinetMemberAssignmentsRequest = z.infer<
  typeof ReplaceCabinetMemberAssignmentsRequestSchema
>;
export type ListCabinetMembersResponse = z.infer<
  typeof ListCabinetMembersResponseSchema
>;
export type GetCabinetMemberResponse = z.infer<
  typeof GetCabinetMemberResponseSchema
>;
export type CreateCabinetInvitationResponse = z.infer<
  typeof CreateCabinetInvitationResponseSchema
>;
export type ListCabinetInvitationsResponse = z.infer<
  typeof ListCabinetInvitationsResponseSchema
>;
export type AcceptCabinetInvitationResponse = z.infer<
  typeof AcceptCabinetInvitationResponseSchema
>;
export type ListCabinetMemberAssignmentsResponse = z.infer<
  typeof ListCabinetMemberAssignmentsResponseSchema
>;
export type ListCabinetDossierMembersResponse = z.infer<
  typeof ListCabinetDossierMembersResponseSchema
>;
