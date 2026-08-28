import { AppError } from "@/lambda/shared/app-error";
import { AccountingAuthorizationRepository } from "@/lambda/shared/repositories/accounting-authorization-repository";
import { CabinetTeamRepository } from "@/lambda/shared/repositories/cabinet-team-repository";
import { EffectiveOrganizationAccessService } from "@/lambda/shared/services/effective-organization-access-service";
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

const activeCabinetMember = (
  cabinetRole: "CABINET_ADMIN" | "SUPERVISOR" | "COLLABORATOR" | "READER",
) => ({
  cabinetId: "cab-1",
  cabinetRole,
  orgId: "cabinet-org-1",
  status: "ACTIVE" as const,
  updatedAt: "2026-07-19T00:00:00.000Z",
  userId: "member-1",
  workspaceType: "ACCOUNTING_FIRM",
});

describe("EffectiveOrganizationAccessService", () => {
  afterEach(() => jest.restoreAllMocks());

  test("resolves an active direct company membership as READ_WRITE without dossier reads", async () => {
    const directAccess = jest
      .spyOn(TenantAccessService, "assertUserCanAccessOrg")
      .mockResolvedValue({
        accessSource: "DIRECT",
        accountingFramework: "SYSCOHADA_REVISED",
        role: "ACCOUNTANT",
        workspaceType: "COMPANY",
      });
    const cabinetMember = jest.spyOn(CabinetTeamRepository, "getMember");
    const snapshot = jest.spyOn(
      AccountingAuthorizationRepository,
      "getSnapshot",
    );

    await expect(
      EffectiveOrganizationAccessService.resolveAccess({
        orgId: "company-1",
        userId: "user-1",
      }),
    ).resolves.toMatchObject({
      accessMode: "READ_WRITE",
      accessSource: "DIRECT",
      orgId: "company-1",
      permissions: expect.arrayContaining([
        "ACCOUNTING_READ",
        "PROJECTS_READ",
        "TREASURY_READ",
      ]),
      workspaceOrgId: "company-1",
    });
    expect(directAccess).toHaveBeenCalledTimes(1);
    expect(cabinetMember).not.toHaveBeenCalled();
    expect(snapshot).not.toHaveBeenCalled();
  });

  test("grants SALES read/write to a direct company OWNER", async () => {
    jest.spyOn(TenantAccessService, "assertUserCanAccessOrg").mockResolvedValue({
      accessSource: "DIRECT",
      role: "OWNER",
      workspaceType: "COMPANY",
    });

    await expect(
      EffectiveOrganizationAccessService.resolveAccess({
        orgId: "company-1",
        userId: "owner-1",
      }),
    ).resolves.toMatchObject({
      permissions: expect.arrayContaining(["SALES_READ", "SALES_WRITE"]),
    });
  });

  test.each(["missing", "inactive"])(
    "preserves %s direct membership denial",
    async () => {
      jest
        .spyOn(TenantAccessService, "assertUserCanAccessOrg")
        .mockRejectedValue(new AppError(403, "ERROR_ORG_ACCESS_DENIED"));

      await expect(
        EffectiveOrganizationAccessService.resolveAccess({
          orgId: "company-1",
          userId: "user-1",
        }),
      ).rejects.toMatchObject({
        messageCode: "ERROR_ORG_ACCESS_DENIED",
        statusCode: 403,
      });
    },
  );

  test("resolves an assigned Cabinet READER as READ_ONLY", async () => {
    jest
      .spyOn(CabinetTeamRepository, "getMember")
      .mockResolvedValue(activeCabinetMember("READER"));
    const snapshot = jest
      .spyOn(AccountingAuthorizationRepository, "getSnapshot")
      .mockResolvedValue(activeDossierSnapshot(true));

    await expect(
      EffectiveOrganizationAccessService.resolveAccess({
        orgId: "dossier-1",
        userId: "member-1",
        workspaceOrgId: "cabinet-org-1",
      }),
    ).resolves.toMatchObject({
      accessMode: "READ_ONLY",
      accessSource: "CABINET",
      cabinetRole: "READER",
      orgId: "dossier-1",
    });
    expect(snapshot).toHaveBeenCalledTimes(1);
    expect(snapshot).toHaveBeenCalledWith(
      expect.objectContaining({ includeAssignment: true }),
    );
  });

  test("resolves a Cabinet Administrator as READ_WRITE without assignment", async () => {
    jest
      .spyOn(CabinetTeamRepository, "getMember")
      .mockResolvedValue(activeCabinetMember("CABINET_ADMIN"));
    const snapshot = jest
      .spyOn(AccountingAuthorizationRepository, "getSnapshot")
      .mockResolvedValue(activeDossierSnapshot(false));

    const access = await EffectiveOrganizationAccessService.resolveAccess(
      {
        orgId: "dossier-1",
        userId: "member-1",
        workspaceOrgId: "cabinet-org-1",
      },
    );
    expect(access).toMatchObject({
      accessMode: "READ_WRITE",
      cabinetRole: "CABINET_ADMIN",
    });
    expect(access.permissions).not.toContain("SALES_READ");
    expect(access.permissions).not.toContain("SALES_WRITE");
    expect(snapshot).toHaveBeenCalledWith(
      expect.objectContaining({ includeAssignment: false }),
    );
  });

  test.each(["COLLABORATOR", "SUPERVISOR"] as const)(
    "resolves an assigned %s as READ_WRITE",
    async (cabinetRole) => {
      jest
        .spyOn(CabinetTeamRepository, "getMember")
        .mockResolvedValue(activeCabinetMember(cabinetRole));
      jest
        .spyOn(AccountingAuthorizationRepository, "getSnapshot")
        .mockResolvedValue(activeDossierSnapshot(true));

      await expect(
        EffectiveOrganizationAccessService.resolveAccess({
          orgId: "dossier-1",
          userId: "member-1",
          workspaceOrgId: "cabinet-org-1",
        }),
      ).resolves.toMatchObject({ accessMode: "READ_WRITE", cabinetRole });
    },
  );

  test("denies an unrelated dossier without changing ownership semantics", async () => {
    jest
      .spyOn(CabinetTeamRepository, "getMember")
      .mockResolvedValue(activeCabinetMember("CABINET_ADMIN"));
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
      EffectiveOrganizationAccessService.resolveAccess({
        orgId: "dossier-1",
        userId: "member-1",
        workspaceOrgId: "cabinet-org-1",
      }),
    ).rejects.toMatchObject({ messageCode: "CABINET_DOSSIER_NOT_OWNED" });
  });

  test("denies inactive Cabinet membership before the dossier snapshot read", async () => {
    jest.spyOn(CabinetTeamRepository, "getMember").mockResolvedValue({
      ...activeCabinetMember("CABINET_ADMIN"),
      status: "SUSPENDED",
    });
    const snapshot = jest.spyOn(
      AccountingAuthorizationRepository,
      "getSnapshot",
    );

    await expect(
      EffectiveOrganizationAccessService.resolveAccess({
        orgId: "dossier-1",
        userId: "member-1",
        workspaceOrgId: "cabinet-org-1",
      }),
    ).rejects.toMatchObject({ messageCode: "CABINET_MEMBER_NOT_ACTIVE" });
    expect(snapshot).not.toHaveBeenCalled();
  });
});
