import {
  CabinetDashboardRequestSchema,
  CabinetDashboardResponseSchema,
  CabinetDashboardScopeSchema,
} from "@liass-ohada/shared/shared";

describe("Cabinet dashboard shared contracts", () => {
  test("accepts canonical backend-derived scopes only", () => {
    expect(CabinetDashboardScopeSchema.parse("CABINET")).toBe("CABINET");
    expect(CabinetDashboardScopeSchema.parse("PERSONAL_ACTIVITY")).toBe(
      "PERSONAL_ACTIVITY",
    );
    expect(() => CabinetDashboardScopeSchema.parse("ADMIN_VIEW")).toThrow();
  });

  test("validates attention limit boundaries", () => {
    expect(CabinetDashboardRequestSchema.parse({ attentionLimit: "10" })).toEqual({
      attentionLimit: 10,
    });
    expect(CabinetDashboardRequestSchema.parse({})).toEqual({
      attentionLimit: 5,
    });
    expect(() =>
      CabinetDashboardRequestSchema.parse({ attentionLimit: 0 }),
    ).toThrow();
    expect(() =>
      CabinetDashboardRequestSchema.parse({ attentionLimit: 11 }),
    ).toThrow();
  });

  test("validates response shape, optional team summary, and non-negative metrics", () => {
    expect(
      CabinetDashboardResponseSchema.parse({
        generatedAt: "2026-07-26T18:30:00.000Z",
        asOfDate: "2026-07-26",
        scope: "CABINET",
        cabinet: {
          cabinetOrgId: "cabinet-org-1",
          displayName: "CLO COMPTABILITE",
        },
        portfolio: { accessibleDossiers: 2, activeDossiers: 2 },
        team: {
          activeMembers: 4,
          administrators: 1,
          supervisors: 1,
          collaborators: 1,
          readers: 1,
        },
        work: {
          totalActive: 3,
          toPlan: 0,
          toDo: 1,
          inProgress: 1,
          waiting: 1,
          overdue: 1,
          dueSoon: 1,
          unassigned: 1,
        },
        deadlines: {
          pending: 3,
          overdue: 1,
          dueToday: 1,
          next7Days: 1,
          next30Days: 0,
        },
        attention: {
          overdueWorks: [
            {
              workId: "wrk-1",
              dossierOrgId: "dossier-1",
              dossierName: "Client A",
              title: "Cloture",
              type: "MONTHLY_CLOSE",
              priority: "HIGH",
              status: "TO_DO",
              dueDate: "2026-07-25",
            },
          ],
          overdueDeadlines: [],
          upcomingDeadlines: [],
        },
      }),
    ).toMatchObject({ scope: "CABINET" });

    expect(() =>
      CabinetDashboardResponseSchema.parse({
        generatedAt: "2026-07-26T18:30:00.000Z",
        asOfDate: "2026-07-26",
        scope: "CABINET",
        cabinet: { cabinetOrgId: "cabinet-org-1", displayName: "Cabinet" },
        portfolio: { accessibleDossiers: -1, activeDossiers: 0 },
        work: {
          totalActive: 0,
          toPlan: 0,
          toDo: 0,
          inProgress: 0,
          waiting: 0,
          overdue: 0,
          dueSoon: 0,
        },
        deadlines: {
          pending: 0,
          overdue: 0,
          dueToday: 0,
          next7Days: 0,
          next30Days: 0,
        },
        attention: {
          overdueWorks: [],
          overdueDeadlines: [],
          upcomingDeadlines: [],
        },
      }),
    ).toThrow();
  });
});
