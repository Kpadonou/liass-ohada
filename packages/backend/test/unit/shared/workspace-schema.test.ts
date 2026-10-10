import {
  AccountingAccessModeSchema,
  CabinetDossierSummarySchema,
  CabinetSchema,
  CreateCabinetDossierRequestSchema,
  CreateCabinetDossierResponseSchema,
  CreateInitialWorkspaceRequestSchema,
  CreateInitialWorkspaceResponseSchema,
  ListCabinetDossiersResponseSchema,
  OrganizationSchema,
  WorkspaceCountrySchema,
  WorkspaceTypeSchema,
} from "@liass-ohada/shared";

describe("workspace shared schemas", () => {
  test("supports canonical read/write modes and defaults legacy dossier summaries to writable", () => {
    expect(AccountingAccessModeSchema.parse("READ_ONLY")).toBe("READ_ONLY");
    expect(AccountingAccessModeSchema.parse("READ_WRITE")).toBe("READ_WRITE");
    expect(AccountingAccessModeSchema.safeParse("READER").success).toBe(false);
    expect(
      CabinetDossierSummarySchema.parse({
        accountingFramework: "SYSCOHADA_REVISED",
        country: "BJ",
        createdAt: "2026-06-03T00:00:00.000Z",
        displayName: "Demo SARL",
        orgId: "org-123",
        status: "ACTIVE",
        updatedAt: "2026-06-03T00:00:00.000Z",
      }).accessMode,
    ).toBe("READ_WRITE");
  });
  test("accepts only the initial workspace request contract", () => {
    const parsed = CreateInitialWorkspaceRequestSchema.parse({
      workspaceType: "COMPANY",
      products: ["ACCOUNTING"],
      organizationName: "  Demo SARL  ",
      country: "BJ",
      accountingFramework: "SYSCOHADA_REVISED",
    });

    expect(parsed).toEqual({
      workspaceType: "COMPANY",
      products: ["ACCOUNTING"],
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
          products: ["ACCOUNTING"],
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

  test("accepts only the strict cabinet dossier request contract", () => {
    const parsed = CreateCabinetDossierRequestSchema.parse({
      companyName: "  Client SARL  ",
      country: "BJ",
      accountingFramework: "SYSCOHADA_REVISED",
    });

    expect(parsed.companyName).toBe("Client SARL");
    expect(() =>
      CreateCabinetDossierRequestSchema.parse({
        companyName: "Client SARL",
        country: "BJ",
        accountingFramework: "SYSCOHADA_REVISED",
        orgId: "attacker-org",
      }),
    ).toThrow();
  });

  test("rejects persistence keys in cabinet dossier DTOs", () => {
    expect(() =>
      CabinetDossierSummarySchema.parse({
        orgId: "org-client",
        displayName: "Client SARL",
        country: "BJ",
        accountingFramework: "SYSCOHADA_REVISED",
        status: "ACTIVE",
        createdAt: "2026-06-03T00:00:00.000Z",
        updatedAt: "2026-06-03T00:00:00.000Z",
        PK: "CABINET#cab-123",
        GSI1PK: "CABINET#cab-123",
        entityType: "CABINET_DOSSIER",
      }),
    ).toThrow();
  });

  test("accepts cabinet dossier list and creation responses", () => {
    const dossier = {
      orgId: "org-client",
      displayName: "Client SARL",
      country: "BJ",
      accountingFramework: "SYSCOHADA_REVISED",
      status: "ACTIVE",
      createdAt: "2026-06-03T00:00:00.000Z",
      updatedAt: "2026-06-03T00:00:00.000Z",
    };

    expect(
      ListCabinetDossiersResponseSchema.parse({ dossiers: [dossier] }),
    ).toEqual({
      dossiers: [{ ...dossier, accessMode: "READ_WRITE" }],
    });
    expect(
      CreateCabinetDossierResponseSchema.parse({
        dossier,
        activeDossierOrgId: "org-client",
      }),
    ).toMatchObject({
      activeDossierOrgId: "org-client",
    });
  });
});
