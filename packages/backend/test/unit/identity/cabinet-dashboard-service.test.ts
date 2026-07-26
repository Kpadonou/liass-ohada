import { CabinetDossierRepository } from "@/lambda/shared/repositories/cabinet-dossier-repository";
import { CabinetOperationsRepository } from "@/lambda/shared/repositories/cabinet-operations-repository";
import { CabinetTeamRepository } from "@/lambda/shared/repositories/cabinet-team-repository";
import { UserProfileRepository } from "@/lambda/shared/repositories/user-profile-repository";
import { CabinetAuthorizationService } from "@/lambda/shared/services/cabinet-authorization-service";
import { CabinetDashboardService } from "@/lambda/shared/services/cabinet-dashboard-service";

const context = {
  cabinetId: "cab-1",
  orgId: "cabinet-org-1",
  userId: "admin-1",
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
  updatedAt: "2026-07-26T00:00:00.000Z",
  userId,
  workspaceType: "ACCOUNTING_FIRM",
});

const dossier = (orgId: string, displayName = orgId) => ({
  cabinetId: "cab-1",
  displayName,
  orgId,
  relationship: "CLIENT",
  status: "ACTIVE",
});

const work = (overrides: Record<string, unknown>) => ({
  workId: "wrk-1",
  cabinetOrgId: "cabinet-org-1",
  dossierOrgId: "dossier-1",
  dossierName: "Client 1",
  type: "MONTHLY_CLOSE",
  title: "Cloture mensuelle",
  priority: "NORMAL",
  status: "TO_DO",
  responsibleUserId: "collab-1",
  participantUserIds: [],
  createdBy: "admin-1",
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedBy: "admin-1",
  updatedAt: "2026-07-01T00:00:00.000Z",
  ...overrides,
} as any);

const deadline = (overrides: Record<string, unknown>) => ({
  deadlineId: "ddl-1",
  cabinetOrgId: "cabinet-org-1",
  dossierOrgId: "dossier-1",
  dossierName: "Client 1",
  type: "TAX",
  title: "Declaration TVA",
  priority: "NORMAL",
  status: "PENDING",
  responsibleUserId: "collab-1",
  createdBy: "admin-1",
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedBy: "admin-1",
  updatedAt: "2026-07-01T00:00:00.000Z",
  dueDate: "2026-07-26",
  ...overrides,
} as any);

describe("CabinetDashboardService", () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    jest
      .spyOn(CabinetTeamRepository, "getOrganization")
      .mockResolvedValue({
        orgId: "cabinet-org-1",
        name: "Cabinet Conseil",
        status: "ACTIVE",
        workspaceType: "ACCOUNTING_FIRM",
      });
    jest.spyOn(UserProfileRepository, "batchGet").mockResolvedValue(
      new Map([
        [
          "collab-1",
          {
            userId: "collab-1",
            email: "collab@example.com",
            normalizedEmail: "collab@example.com",
            emailVerified: true,
            displayName: "Collaborateur 1",
            createdAt: "2026-07-01T00:00:00.000Z",
            updatedAt: "2026-07-01T00:00:00.000Z",
            lastSyncedFromIdentityAt: "2026-07-01T00:00:00.000Z",
          },
        ],
      ]),
    );
  });

  test("Cabinet Admin receives cabinet-wide exact metrics and team summary", async () => {
    jest
      .spyOn(CabinetAuthorizationService, "requireActiveMembership")
      .mockResolvedValue({
        cabinetId: "cab-1",
        cabinetOrgId: "cabinet-org-1",
        caller: member("admin-1", "CABINET_ADMIN"),
      });
    jest
      .spyOn(CabinetDossierRepository, "listClientDossiersForDashboard")
      .mockResolvedValue({ items: [{ orgId: "dossier-1" }, { orgId: "dossier-2" }] });
    jest
      .spyOn(CabinetTeamRepository, "getCurrentDossiers")
      .mockResolvedValue([dossier("dossier-1", "Client 1"), dossier("dossier-2")]);
    jest.spyOn(CabinetTeamRepository, "listAllMembers").mockResolvedValue([
      member("admin-1", "CABINET_ADMIN"),
      member("supervisor-1", "SUPERVISOR"),
      member("collab-1", "COLLABORATOR"),
      member("reader-1", "READER"),
    ]);
    jest.spyOn(CabinetOperationsRepository, "listWorksByCabinet").mockResolvedValue({
      items: [
        work({ workId: "wrk-overdue", dueDate: "2026-07-25", priority: "HIGH" }),
        work({ workId: "wrk-today", dueDate: "2026-07-26", status: "IN_PROGRESS" }),
        work({ workId: "wrk-soon", dueDate: "2026-08-02", status: "WAITING" }),
        work({ workId: "wrk-later", dueDate: "2026-08-03" }),
        work({ workId: "wrk-completed", dueDate: "2026-07-25", status: "COMPLETED" }),
        work({ workId: "wrk-cancelled", dueDate: "2026-07-25", status: "CANCELLED" }),
        work({ workId: "wrk-unassigned", dueDate: "2026-07-24", responsibleUserId: undefined }),
      ],
    });
    jest.spyOn(CabinetOperationsRepository, "listDeadlinesByCabinet").mockResolvedValue({
      items: [
        deadline({ deadlineId: "ddl-overdue", dueDate: "2026-07-25" }),
        deadline({ deadlineId: "ddl-today", dueDate: "2026-07-26" }),
        deadline({ deadlineId: "ddl-next7", dueDate: "2026-08-02" }),
        deadline({ deadlineId: "ddl-next30", dueDate: "2026-08-03" }),
        deadline({ deadlineId: "ddl-completed", dueDate: "2026-07-25", status: "COMPLETED" }),
        deadline({ deadlineId: "ddl-cancelled", dueDate: "2026-07-25", status: "CANCELLED" }),
      ],
    });

    const response = await CabinetDashboardService.getDashboard(context, {
      attentionLimit: 2,
      now: new Date("2026-07-26T18:30:00.000Z"),
    });

    expect(response).toMatchObject({
      generatedAt: "2026-07-26T18:30:00.000Z",
      asOfDate: "2026-07-26",
      scope: "CABINET",
      cabinet: { displayName: "Cabinet Conseil" },
      portfolio: { accessibleDossiers: 2, activeDossiers: 2 },
      team: {
        activeMembers: 4,
        administrators: 1,
        supervisors: 1,
        collaborators: 1,
        readers: 1,
      },
      work: {
        totalActive: 5,
        toDo: 3,
        inProgress: 1,
        waiting: 1,
        overdue: 2,
        dueSoon: 2,
        unassigned: 1,
      },
      deadlines: {
        pending: 4,
        overdue: 1,
        dueToday: 1,
        next7Days: 1,
        next30Days: 1,
      },
    });
    expect(response.attention.overdueWorks.map((item) => item.workId)).toEqual([
      "wrk-unassigned",
      "wrk-overdue",
    ]);
    expect(response.attention.upcomingDeadlines.map((item) => item.deadlineId)).toEqual([
      "ddl-today",
      "ddl-next7",
    ]);
  });

  test("Supervisor is scoped to assigned dossiers and omits team summary", async () => {
    jest
      .spyOn(CabinetAuthorizationService, "requireActiveMembership")
      .mockResolvedValue({
        cabinetId: "cab-1",
        cabinetOrgId: "cabinet-org-1",
        caller: member("supervisor-1", "SUPERVISOR"),
      });
    jest.spyOn(CabinetTeamRepository, "listMemberAssignments").mockResolvedValue([
      {
        assignedAt: "2026-07-01T00:00:00.000Z",
        assignedBy: "admin-1",
        cabinetOrgId: "cabinet-org-1",
        dossierOrgId: "dossier-1",
        userId: "supervisor-1",
      },
    ]);
    jest
      .spyOn(CabinetTeamRepository, "getCurrentDossiers")
      .mockResolvedValue([dossier("dossier-1", "Client 1")]);
    jest.spyOn(CabinetTeamRepository, "listAllMembers");
    jest.spyOn(CabinetOperationsRepository, "listWorksByDossier").mockResolvedValue({
      items: [work({ workId: "wrk-assigned", dossierOrgId: "dossier-1" })],
    });
    jest.spyOn(CabinetOperationsRepository, "listDeadlinesByDossier").mockResolvedValue({
      items: [deadline({ deadlineId: "ddl-assigned", dossierOrgId: "dossier-1" })],
    });
    const cabinetWorkSpy = jest.spyOn(CabinetOperationsRepository, "listWorksByCabinet");

    const response = await CabinetDashboardService.getDashboard(
      { ...context, userId: "supervisor-1" },
      { now: new Date("2026-07-26T12:00:00.000Z") },
    );

    expect(response.scope).toBe("SUPERVISED_DOSSIERS");
    expect(response.team).toBeUndefined();
    expect(response.portfolio).toEqual({ accessibleDossiers: 1, activeDossiers: 1 });
    expect(CabinetTeamRepository.listAllMembers).not.toHaveBeenCalled();
    expect(cabinetWorkSpy).not.toHaveBeenCalled();
  });

  test("Collaborator dashboard keeps only personal Work and responsible Deadlines", async () => {
    jest
      .spyOn(CabinetAuthorizationService, "requireActiveMembership")
      .mockResolvedValue({
        cabinetId: "cab-1",
        cabinetOrgId: "cabinet-org-1",
        caller: member("collab-1", "COLLABORATOR"),
      });
    jest.spyOn(CabinetTeamRepository, "listMemberAssignments").mockResolvedValue([
      {
        assignedAt: "2026-07-01T00:00:00.000Z",
        assignedBy: "admin-1",
        cabinetOrgId: "cabinet-org-1",
        dossierOrgId: "dossier-1",
        userId: "collab-1",
      },
    ]);
    jest
      .spyOn(CabinetTeamRepository, "getCurrentDossiers")
      .mockResolvedValue([dossier("dossier-1", "Client 1")]);
    jest.spyOn(CabinetOperationsRepository, "listWorksByDossier").mockResolvedValue({
      items: [
        work({ workId: "responsible", responsibleUserId: "collab-1" }),
        work({ workId: "participant", participantUserIds: ["collab-1"] }),
        work({ workId: "unrelated", responsibleUserId: "other-1" }),
      ],
    });
    const responsibleDeadlineSpy = jest
      .spyOn(CabinetOperationsRepository, "listDeadlinesByResponsibleUser")
      .mockResolvedValue({
        items: [deadline({ deadlineId: "mine", responsibleUserId: "collab-1" })],
      });

    const response = await CabinetDashboardService.getDashboard(
      { ...context, userId: "collab-1" },
      { now: new Date("2026-07-26T12:00:00.000Z") },
    );

    expect(response.scope).toBe("PERSONAL_ACTIVITY");
    expect(response.work.totalActive).toBe(2);
    expect(response.work.unassigned).toBeUndefined();
    expect(response.deadlines.pending).toBe(1);
    expect(response.team).toBeUndefined();
    expect(responsibleDeadlineSpy).toHaveBeenCalledWith(
      expect.objectContaining({ responsibleUserId: "collab-1" }),
    );
  });

  test("aggregation limit fails explicitly instead of returning partial exact counts", async () => {
    jest
      .spyOn(CabinetAuthorizationService, "requireActiveMembership")
      .mockResolvedValue({
        cabinetId: "cab-1",
        cabinetOrgId: "cabinet-org-1",
        caller: member("admin-1", "CABINET_ADMIN"),
      });
    jest
      .spyOn(CabinetDossierRepository, "listClientDossiersForDashboard")
      .mockResolvedValue({ items: [] });
    jest.spyOn(CabinetTeamRepository, "getCurrentDossiers").mockResolvedValue([]);
    jest.spyOn(CabinetTeamRepository, "listAllMembers").mockResolvedValue([]);
    jest.spyOn(CabinetOperationsRepository, "listDeadlinesByCabinet").mockResolvedValue({
      items: [],
    });
    jest.spyOn(CabinetOperationsRepository, "listWorksByCabinet").mockResolvedValue({
      items: Array.from({ length: 1_001 }, (_, index) =>
        work({ workId: `wrk-${index}` }),
      ),
    });

    await expect(
      CabinetDashboardService.getDashboard(context, {
        now: new Date("2026-07-26T12:00:00.000Z"),
      }),
    ).rejects.toMatchObject({
      messageCode: "CABINET_DASHBOARD_AGGREGATION_LIMIT_EXCEEDED",
      statusCode: 413,
    });
  });
});
