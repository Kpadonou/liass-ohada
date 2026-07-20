import { CabinetTeamRepository } from "@/lambda/shared/repositories/cabinet-team-repository";
import { CabinetAuthorizationService } from "@/lambda/shared/services/cabinet-authorization-service";
import { CabinetTeamService } from "@/lambda/shared/services/cabinet-team-service";

const context = {
  cabinetId: "cab-1",
  orgId: "cabinet-org-1",
  userId: "supervisor-1",
  workspaceType: "ACCOUNTING_FIRM" as const,
};

const member = (
  userId: string,
  cabinetRole: "CABINET_ADMIN" | "SUPERVISOR" | "COLLABORATOR" | "READER",
) => ({
  cabinetId: "cab-1",
  cabinetRole,
  orgId: "cabinet-org-1",
  status: "ACTIVE" as const,
  updatedAt: "2026-07-19T00:00:00.000Z",
  userId,
  workspaceType: "ACCOUNTING_FIRM",
});

describe("Cabinet dossier-scoped assignment authorization", () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    jest.spyOn(console, "info").mockImplementation(() => undefined);
    jest.spyOn(CabinetTeamRepository, "getDossiers").mockResolvedValue([
      {
        cabinetId: "cab-1",
        orgId: "dossier-1",
        relationship: "CLIENT",
        status: "ACTIVE",
      },
    ]);
    jest.spyOn(CabinetTeamRepository, "getCabinetMetadata").mockResolvedValue({
      cabinetId: "cab-1",
      orgId: "cabinet-org-1",
      ownerUserId: "admin-1",
      status: "ACTIVE",
    });
    jest.spyOn(CabinetTeamRepository, "getAssignment").mockResolvedValue({
      assignedAt: "2026-07-19T00:00:00.000Z",
      assignedBy: "admin-1",
      cabinetOrgId: "cabinet-org-1",
      dossierOrgId: "dossier-1",
      userId: "supervisor-1",
    });
  });

  test.each(["COLLABORATOR", "READER"] as const)(
    "allows an assigned Supervisor to add and remove a %s",
    async (targetRole) => {
      jest
        .spyOn(CabinetAuthorizationService, "requireActiveMembership")
        .mockResolvedValue({
          cabinetId: "cab-1",
          cabinetOrgId: "cabinet-org-1",
          caller: member("supervisor-1", "SUPERVISOR"),
        });
      jest
        .spyOn(CabinetTeamRepository, "getMember")
        .mockResolvedValue(member("target-1", targetRole));
      jest.spyOn(CabinetTeamRepository, "getAssignment").mockResolvedValue({
        assignedAt: "2026-07-19T00:00:00.000Z",
        assignedBy: "admin-1",
        cabinetOrgId: "cabinet-org-1",
        dossierOrgId: "dossier-1",
        userId: "supervisor-1",
      });
      const add = jest.spyOn(CabinetTeamRepository, "addAssignment").mockResolvedValue();
      const remove = jest
        .spyOn(CabinetTeamRepository, "removeAssignment")
        .mockResolvedValue();

      await CabinetTeamService.addDossierAssignment(
        context,
        "dossier-1",
        "target-1",
      );
      await CabinetTeamService.removeDossierAssignment(
        context,
        "dossier-1",
        "target-1",
      );

      expect(add).toHaveBeenCalledWith(
        expect.objectContaining({ assignedBy: "supervisor-1", userId: "target-1" }),
      );
      expect(remove).toHaveBeenCalledWith({
        cabinetOrgId: "cabinet-org-1",
        dossierOrgId: "dossier-1",
        userId: "target-1",
      });
    },
  );

  test("rejects a Supervisor who is not assigned to the dossier", async () => {
    jest
      .spyOn(CabinetAuthorizationService, "requireActiveMembership")
      .mockResolvedValue({
        cabinetId: "cab-1",
        cabinetOrgId: "cabinet-org-1",
        caller: member("supervisor-1", "SUPERVISOR"),
      });
    jest
      .spyOn(CabinetTeamRepository, "getMember")
      .mockResolvedValue(member("target-1", "COLLABORATOR"));
    jest.spyOn(CabinetTeamRepository, "getAssignment").mockResolvedValue(undefined);

    await expect(
      CabinetTeamService.addDossierAssignment(context, "dossier-1", "target-1"),
    ).rejects.toMatchObject({
      messageCode: "CABINET_SUPERVISOR_ASSIGNMENT_REQUIRED",
    });
  });

  test.each(["CABINET_ADMIN", "SUPERVISOR"] as const)(
    "prevents a Supervisor from managing a %s",
    async (targetRole) => {
      jest
        .spyOn(CabinetAuthorizationService, "requireActiveMembership")
        .mockResolvedValue({
          cabinetId: "cab-1",
          cabinetOrgId: "cabinet-org-1",
          caller: member("supervisor-1", "SUPERVISOR"),
        });
      jest
        .spyOn(CabinetTeamRepository, "getMember")
        .mockResolvedValue(member("target-1", targetRole));

      await expect(
        CabinetTeamService.removeDossierAssignment(context, "dossier-1", "target-1"),
      ).rejects.toMatchObject({
        messageCode: "CABINET_SUPERVISOR_TARGET_ROLE_FORBIDDEN",
      });
    },
  );

  test.each(["COLLABORATOR", "READER"] as const)(
    "prevents a %s from managing assignments",
    async (callerRole) => {
      jest
        .spyOn(CabinetAuthorizationService, "requireActiveMembership")
        .mockResolvedValue({
          cabinetId: "cab-1",
          cabinetOrgId: "cabinet-org-1",
          caller: member("actor-1", callerRole),
        });

      await expect(
        CabinetTeamService.addDossierAssignment(
          { ...context, userId: "actor-1" },
          "dossier-1",
          "target-1",
        ),
      ).rejects.toMatchObject({ messageCode: "CABINET_MEMBER_ROLE_FORBIDDEN" });
    },
  );
});
