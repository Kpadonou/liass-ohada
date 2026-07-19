import {
  AcceptCabinetInvitationResponseSchema,
  CabinetDossierAssignmentSchema,
  CabinetInvitationSchema,
  CabinetInvitationStatusSchema,
  CabinetMemberSchema,
  CabinetMemberStatusSchema,
  CabinetRoleSchema,
  CreateCabinetInvitationRequestSchema,
  ListCabinetMembersRequestSchema,
  ListCabinetMembersResponseSchema,
  ReplaceCabinetMemberAssignmentsRequestSchema,
} from "@liass-ohada/shared";

describe("Cabinet team shared contracts", () => {
  test.each([
    "CABINET_ADMIN",
    "SUPERVISOR",
    "COLLABORATOR",
    "READER",
  ])("accepts the canonical Cabinet role %s", (role) => {
    expect(CabinetRoleSchema.parse(role)).toBe(role);
  });

  test("rejects deprecated supervisory role names", () => {
    expect(CabinetRoleSchema.safeParse("MISSION_MANAGER").success).toBe(false);
    expect(CabinetRoleSchema.safeParse("RESPONSABLE_MISSION").success).toBe(
      false,
    );
  });

  test.each(["ACTIVE", "SUSPENDED", "REVOKED"])(
    "accepts member status %s",
    (status) => expect(CabinetMemberStatusSchema.parse(status)).toBe(status),
  );

  test.each(["PENDING", "ACCEPTED", "EXPIRED", "CANCELLED"])(
    "accepts invitation status %s",
    (status) => expect(CabinetInvitationStatusSchema.parse(status)).toBe(status),
  );

  test("normalizes invitation email and validates unique initial dossiers", () => {
    expect(
      CreateCabinetInvitationRequestSchema.parse({
        email: "  Member@Example.COM ",
        role: "SUPERVISOR",
        initialDossierOrgIds: ["org-1", "org-2"],
      }),
    ).toEqual({
      email: "member@example.com",
      role: "SUPERVISOR",
      initialDossierOrgIds: ["org-1", "org-2"],
    });
    expect(
      CreateCabinetInvitationRequestSchema.safeParse({
        email: "member@example.com",
        role: "READER",
        initialDossierOrgIds: ["org-1", "org-1"],
      }).success,
    ).toBe(false);
  });

  test("enforces the 20-dossier invitation limit", () => {
    expect(
      CreateCabinetInvitationRequestSchema.safeParse({
        email: "member@example.com",
        role: "COLLABORATOR",
        initialDossierOrgIds: Array.from({ length: 21 }, (_, index) =>
          `org-${index}`,
        ),
      }).success,
    ).toBe(false);
  });

  test("uses the existing cursor and hasMore response convention", () => {
    expect(
      ListCabinetMembersRequestSchema.parse({ limit: "25", cursor: "cursor" }),
    ).toMatchObject({ limit: 25, cursor: "cursor" });
    expect(
      ListCabinetMembersResponseSchema.parse({
        members: [],
        nextCursor: "next",
      }).hasMore,
    ).toBe(true);
  });

  test("validates member, invitation, assignment, and acceptance responses", () => {
    const now = "2026-07-19T12:00:00.000Z";
    const member = CabinetMemberSchema.parse({
      userId: "user-1",
      cabinetRole: "CABINET_ADMIN",
      status: "ACTIVE",
      updatedAt: now,
    });
    const invitation = CabinetInvitationSchema.parse({
      invitationId: "inv-1",
      email: "member@example.com",
      role: "COLLABORATOR",
      status: "PENDING",
      invitedBy: "admin-1",
      createdAt: now,
      expiresAt: "2026-07-26T12:00:00.000Z",
    });
    const assignment = CabinetDossierAssignmentSchema.parse({
      userId: "user-1",
      dossierOrgId: "org-client",
      assignedBy: "admin-1",
      assignedAt: now,
    });
    expect(invitation.initialDossierOrgIds).toEqual([]);
    expect(
      AcceptCabinetInvitationResponseSchema.parse({
        member,
        assignments: [assignment],
      }),
    ).toBeDefined();
    expect(
      ReplaceCabinetMemberAssignmentsRequestSchema.safeParse({
        dossierOrgIds: ["org-client", "org-client"],
      }).success,
    ).toBe(false);
  });
});
