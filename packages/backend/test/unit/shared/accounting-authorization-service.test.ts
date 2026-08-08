import { AccountingAuthorizationRepository } from "@/lambda/shared/repositories/accounting-authorization-repository";
import { CabinetTeamRepository } from "@/lambda/shared/repositories/cabinet-team-repository";
import { AccountingAuthorizationService } from "@/lambda/shared/services/accounting-authorization-service";
import { TenantAccessService } from "@/lambda/shared/services/tenant-access-service";

const activeDossierSnapshot = (assignmentExists: boolean) => ({
  assignmentExists,
  dossier: {
    cabinetId: "cab-1",
    orgId: "dossier-1",
    relationship: "CLIENT",
    status: "ACTIVE",
  },
  organization: {
    accountingFramework: "SYSCOHADA_REVISED",
    orgId: "dossier-1",
    status: "ACTIVE",
    workspaceType: "COMPANY",
  },
});

describe("AccountingAuthorizationService", () => {
  afterEach(() => jest.restoreAllMocks());

  test("preserves active direct-company read and write access without Cabinet assignment", async () => {
    jest.spyOn(TenantAccessService, "assertUserCanAccessOrg").mockResolvedValue({
      accessSource: "DIRECT",
      accountingFramework: "SYSCOHADA_REVISED",
      role: "ACCOUNTANT",
      workspaceType: "COMPANY",
    });
    const snapshot = jest.spyOn(
      AccountingAuthorizationRepository,
      "getSnapshot",
    );

    await expect(
      AccountingAuthorizationService.resolve({
        orgId: "company-1",
        permission: "ACCOUNTING_WRITE",
        userId: "user-1",
      }),
    ).resolves.toMatchObject({
      accessMode: "READ_WRITE",
      accessSource: "DIRECT",
      orgId: "company-1",
      permissions: expect.arrayContaining([
        "ACCOUNTING_READ",
        "ACCOUNTING_WRITE",
      ]),
    });
    expect(snapshot).not.toHaveBeenCalled();
  });

  test("does not silently treat a Cabinet-created dossier access row as direct access", async () => {
    jest.spyOn(TenantAccessService, "assertUserCanAccessOrg").mockResolvedValue({
      accessSource: "CABINET",
      workspaceType: "COMPANY",
    });
    await expect(
      AccountingAuthorizationService.resolve({
        orgId: "dossier-1",
        permission: "ACCOUNTING_READ",
        userId: "user-1",
      }),
    ).rejects.toMatchObject({
      messageCode: "ACCOUNTING_ACCESS_CONTEXT_INVALID",
    });
  });

  test.each(["ACCOUNTING_READ", "ACCOUNTING_WRITE"] as const)(
    "allows an active Cabinet Administrator %s without assignment",
    async (permission) => {
      jest.spyOn(CabinetTeamRepository, "getMember").mockResolvedValue({
        cabinetId: "cab-1",
        cabinetRole: "CABINET_ADMIN",
        orgId: "cabinet-org-1",
        status: "ACTIVE",
        updatedAt: "2026-07-19T00:00:00.000Z",
        userId: "admin-1",
        workspaceType: "ACCOUNTING_FIRM",
      });
      const snapshot = jest
        .spyOn(AccountingAuthorizationRepository, "getSnapshot")
        .mockResolvedValue(activeDossierSnapshot(false));

      await expect(
        AccountingAuthorizationService.resolve({
          orgId: "dossier-1",
          permission,
          userId: "admin-1",
          workspaceOrgId: "cabinet-org-1",
        }),
      ).resolves.toMatchObject({ accessMode: "READ_WRITE" });
      expect(snapshot).toHaveBeenCalledWith(
        expect.objectContaining({ includeAssignment: false }),
      );
    },
  );

  test.each(["SUPERVISOR", "COLLABORATOR"] as const)(
    "allows an assigned %s to read and write",
    async (cabinetRole) => {
      jest.spyOn(CabinetTeamRepository, "getMember").mockResolvedValue({
        cabinetId: "cab-1",
        cabinetRole,
        orgId: "cabinet-org-1",
        status: "ACTIVE",
        updatedAt: "2026-07-19T00:00:00.000Z",
        userId: "member-1",
        workspaceType: "ACCOUNTING_FIRM",
      });
      jest
        .spyOn(AccountingAuthorizationRepository, "getSnapshot")
        .mockResolvedValue(activeDossierSnapshot(true));

      await expect(
        AccountingAuthorizationService.resolve({
          orgId: "dossier-1",
          permission: "ACCOUNTING_WRITE",
          userId: "member-1",
          workspaceOrgId: "cabinet-org-1",
        }),
      ).resolves.toMatchObject({ accessMode: "READ_WRITE", cabinetRole });
    },
  );

  test("rejects an unassigned non-administrator", async () => {
    jest.spyOn(CabinetTeamRepository, "getMember").mockResolvedValue({
      cabinetId: "cab-1",
      cabinetRole: "COLLABORATOR",
      orgId: "cabinet-org-1",
      status: "ACTIVE",
      updatedAt: "2026-07-19T00:00:00.000Z",
      userId: "member-1",
      workspaceType: "ACCOUNTING_FIRM",
    });
    jest
      .spyOn(AccountingAuthorizationRepository, "getSnapshot")
      .mockResolvedValue(activeDossierSnapshot(false));

    await expect(
      AccountingAuthorizationService.resolve({
        orgId: "dossier-1",
        permission: "ACCOUNTING_READ",
        userId: "member-1",
        workspaceOrgId: "cabinet-org-1",
      }),
    ).rejects.toMatchObject({
      messageCode: "CABINET_DOSSIER_ASSIGNMENT_REQUIRED",
    });
  });

  test("allows an assigned Reader to read and rejects writes immediately", async () => {
    jest.spyOn(CabinetTeamRepository, "getMember").mockResolvedValue({
      cabinetId: "cab-1",
      cabinetRole: "READER",
      orgId: "cabinet-org-1",
      status: "ACTIVE",
      updatedAt: "2026-07-19T00:00:00.000Z",
      userId: "reader-1",
      workspaceType: "ACCOUNTING_FIRM",
    });
    jest
      .spyOn(AccountingAuthorizationRepository, "getSnapshot")
      .mockResolvedValue(activeDossierSnapshot(true));

    await expect(
      AccountingAuthorizationService.resolve({
        orgId: "dossier-1",
        permission: "ACCOUNTING_READ",
        userId: "reader-1",
        workspaceOrgId: "cabinet-org-1",
      }),
    ).resolves.toMatchObject({ accessMode: "READ_ONLY" });
    await expect(
      AccountingAuthorizationService.resolve({
        orgId: "dossier-1",
        permission: "ACCOUNTING_WRITE",
        userId: "reader-1",
        workspaceOrgId: "cabinet-org-1",
      }),
    ).rejects.toEqual(
      expect.objectContaining({
        messageCode: "CABINET_DOSSIER_READ_ONLY",
        statusCode: 403,
      }),
    );
  });

  test("rejects a dossier relationship owned by another Cabinet", async () => {
    jest.spyOn(CabinetTeamRepository, "getMember").mockResolvedValue({
      cabinetId: "cab-1",
      cabinetRole: "CABINET_ADMIN",
      orgId: "cabinet-org-1",
      status: "ACTIVE",
      updatedAt: "2026-07-19T00:00:00.000Z",
      userId: "admin-1",
      workspaceType: "ACCOUNTING_FIRM",
    });
    jest
      .spyOn(AccountingAuthorizationRepository, "getSnapshot")
      .mockResolvedValue({
        ...activeDossierSnapshot(false),
        dossier: {
          ...activeDossierSnapshot(false).dossier,
          cabinetId: "cab-other",
        },
      });

    await expect(
      AccountingAuthorizationService.resolve({
        orgId: "dossier-1",
        permission: "ACCOUNTING_READ",
        userId: "admin-1",
        workspaceOrgId: "cabinet-org-1",
      }),
    ).rejects.toMatchObject({ messageCode: "CABINET_DOSSIER_NOT_OWNED" });
  });

  test.each(["SUSPENDED", "REVOKED"] as const)(
    "rejects a %s Cabinet member before loading dossier authorization",
    async (status) => {
      jest.spyOn(CabinetTeamRepository, "getMember").mockResolvedValue({
        cabinetId: "cab-1",
        cabinetRole: "CABINET_ADMIN",
        orgId: "cabinet-org-1",
        status,
        updatedAt: "2026-07-19T00:00:00.000Z",
        userId: "admin-1",
        workspaceType: "ACCOUNTING_FIRM",
      });
      const snapshot = jest.spyOn(
        AccountingAuthorizationRepository,
        "getSnapshot",
      );

      await expect(
        AccountingAuthorizationService.resolve({
          orgId: "dossier-1",
          permission: "ACCOUNTING_READ",
          userId: "admin-1",
          workspaceOrgId: "cabinet-org-1",
        }),
      ).rejects.toMatchObject({ messageCode: "CABINET_MEMBER_NOT_ACTIVE" });
      expect(snapshot).not.toHaveBeenCalled();
    },
  );
});
