import {
  CabinetSchema,
  CreateInitialWorkspaceRequestSchema,
  CreateInitialWorkspaceResponseSchema,
  OrganizationSchema,
  WorkspaceCountrySchema,
  WorkspaceTypeSchema,
} from "@liass-ohada/shared";

describe("workspace shared schemas", () => {
  test("accepts only the initial workspace request contract", () => {
    const parsed = CreateInitialWorkspaceRequestSchema.parse({
      workspaceType: "COMPANY",
      organizationName: "  Demo SARL  ",
      country: "BJ",
      accountingFramework: "SYSCOHADA_REVISED",
    });

    expect(parsed).toEqual({
      workspaceType: "COMPANY",
      organizationName: "Demo SARL",
      country: "BJ",
      accountingFramework: "SYSCOHADA_REVISED",
    });
  });

  test.each(["role", "ownerUserId", "cabinetId", "unexpectedKey"])(
    "rejects unknown request key %s",
    (unknownKey) => {
      expect(() =>
        CreateInitialWorkspaceRequestSchema.parse({
          workspaceType: "COMPANY",
          organizationName: "Demo SARL",
          country: "BJ",
          accountingFramework: "SYSCOHADA_REVISED",
          [unknownKey]: "client-controlled",
        }),
      ).toThrow();
    },
  );

  test("rejects persistence keys in frontend-safe organization and cabinet DTOs", () => {
    expect(() =>
      OrganizationSchema.parse({
        orgId: "org-123",
        name: "Demo SARL",
        country: "BJ",
        accountingFramework: "SYSCOHADA_REVISED",
        workspaceType: "COMPANY",
        status: "ACTIVE",
        createdAt: "2026-06-03T00:00:00.000Z",
        updatedAt: "2026-06-03T00:00:00.000Z",
        PK: "ORG#org-123",
        entityType: "ORGANIZATION",
      }),
    ).toThrow();

    expect(() =>
      CabinetSchema.parse({
        cabinetId: "cab-123",
        orgId: "org-123",
        name: "Cabinet Demo",
        country: "BJ",
        status: "ACTIVE",
        ownerUserId: "user-123",
        createdAt: "2026-06-03T00:00:00.000Z",
        updatedAt: "2026-06-03T00:00:00.000Z",
        SK: "CABINET#METADATA",
        GSI6PK: "USER#user-123",
      }),
    ).toThrow();
  });

  test("accepts company onboarding response with null cabinet", () => {
    expect(
      CreateInitialWorkspaceResponseSchema.parse({
        organization: {
          orgId: "org-123",
          name: "Demo SARL",
          country: "BJ",
          accountingFramework: "SYSCOHADA_REVISED",
          workspaceType: "COMPANY",
          status: "ACTIVE",
          createdAt: "2026-06-03T00:00:00.000Z",
          updatedAt: "2026-06-03T00:00:00.000Z",
        },
        cabinet: null,
        workspace: {
          orgId: "org-123",
          role: "OWNER",
          accessSource: "DIRECT",
          displayName: "Demo SARL",
          workspaceType: "COMPANY",
          status: "ACTIVE",
          country: "BJ",
          accountingFramework: "SYSCOHADA_REVISED",
        },
        activeOrgId: "org-123",
      }),
    ).toMatchObject({
      cabinet: null,
      activeOrgId: "org-123",
    });
  });

  test("accepts accounting firm onboarding response with cabinet DTO", () => {
    expect(
      CreateInitialWorkspaceResponseSchema.parse({
        organization: {
          orgId: "org-123",
          name: "Cabinet Demo",
          country: "BJ",
          accountingFramework: "SYSCOHADA_REVISED",
          workspaceType: "ACCOUNTING_FIRM",
          status: "ACTIVE",
          createdAt: "2026-06-03T00:00:00.000Z",
          updatedAt: "2026-06-03T00:00:00.000Z",
        },
        cabinet: {
          cabinetId: "cab-123",
          orgId: "org-123",
          name: "Cabinet Demo",
          country: "BJ",
          status: "ACTIVE",
          ownerUserId: "user-123",
          createdAt: "2026-06-03T00:00:00.000Z",
          updatedAt: "2026-06-03T00:00:00.000Z",
        },
        workspace: {
          orgId: "org-123",
          role: "OWNER",
          cabinetId: "cab-123",
          accessSource: "DIRECT",
          displayName: "Cabinet Demo",
          workspaceType: "ACCOUNTING_FIRM",
          status: "ACTIVE",
          country: "BJ",
          accountingFramework: "SYSCOHADA_REVISED",
        },
        activeOrgId: "org-123",
      }),
    ).toMatchObject({
      cabinet: {
        cabinetId: "cab-123",
      },
    });
  });

  test("rejects persistence keys in onboarding response DTOs", () => {
    expect(() =>
      CreateInitialWorkspaceResponseSchema.parse({
        organization: {
          orgId: "org-123",
          name: "Demo SARL",
          country: "BJ",
          accountingFramework: "SYSCOHADA_REVISED",
          workspaceType: "COMPANY",
          status: "ACTIVE",
          createdAt: "2026-06-03T00:00:00.000Z",
          updatedAt: "2026-06-03T00:00:00.000Z",
        },
        cabinet: null,
        workspace: {
          orgId: "org-123",
          displayName: "Demo SARL",
          PK: "ORG#org-123",
        },
        activeOrgId: "org-123",
      }),
    ).toThrow();
  });

  test("rejects invalid workspace type and country values", () => {
    expect(() => WorkspaceTypeSchema.parse("CABINET")).toThrow();
    expect(() => WorkspaceCountrySchema.parse("US")).toThrow();
  });
});
