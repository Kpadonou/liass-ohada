import { handler } from "@/lambda/domains/identity/get-cabinet-dashboard";
import { CabinetDashboardService } from "@/lambda/shared/services/cabinet-dashboard-service";
import { TenantAccessService } from "@/lambda/shared/services/tenant-access-service";

jest.mock("@/lambda/shared/services/cabinet-dashboard-service", () => ({
  CabinetDashboardService: {
    getDashboard: jest.fn(),
  },
}));

jest.mock("@/lambda/shared/services/tenant-access-service", () => ({
  TenantAccessService: {
    assertUserCanAccessOrg: jest.fn(),
  },
}));

const createEvent = ({
  headers = { "accept-language": "en", "x-org-id": "cabinet-org-1" },
  queryStringParameters,
}: {
  headers?: Record<string, string>;
  queryStringParameters?: Record<string, string>;
} = {}) => ({
  version: "2.0",
  routeKey: "GET /cabinet/dashboard",
  rawPath: "/cabinet/dashboard",
  rawQueryString: "",
  headers,
  queryStringParameters,
  requestContext: {
    http: {
      method: "GET",
      path: "/cabinet/dashboard",
      protocol: "HTTP/1.1",
      sourceIp: "127.0.0.1",
      userAgent: "jest",
    },
    authorizer: {
      jwt: {
        claims: { sub: "admin-1" },
        scopes: [],
      },
    },
  },
  isBase64Encoded: false,
});

const dashboardResponse = {
  generatedAt: "2026-07-26T18:30:00.000Z",
  asOfDate: "2026-07-26",
  scope: "CABINET",
  cabinet: { cabinetOrgId: "cabinet-org-1", displayName: "Cabinet Conseil" },
  portfolio: { accessibleDossiers: 0, activeDossiers: 0 },
  work: {
    totalActive: 0,
    toPlan: 0,
    toDo: 0,
    inProgress: 0,
    waiting: 0,
    overdue: 0,
    dueSoon: 0,
    unassigned: 0,
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
};

describe("get cabinet dashboard handler", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("passes verified cabinet request context and validated attention limit", async () => {
    jest.mocked(TenantAccessService.assertUserCanAccessOrg).mockResolvedValue({
      role: "OWNER",
      cabinetId: "cab-1",
      workspaceType: "ACCOUNTING_FIRM",
    });
    jest
      .mocked(CabinetDashboardService.getDashboard)
      .mockResolvedValue(dashboardResponse as any);

    const response = await handler(
      createEvent({ queryStringParameters: { attentionLimit: "7" } }) as any,
    );

    expect(response.statusCode).toBe(200);
    expect(CabinetDashboardService.getDashboard).toHaveBeenCalledWith(
      {
        orgId: "cabinet-org-1",
        userId: "admin-1",
        cabinetId: "cab-1",
        workspaceType: "ACCOUNTING_FIRM",
      },
      { attentionLimit: 7 },
    );
  });

  test("rejects direct company workspace context", async () => {
    jest.mocked(TenantAccessService.assertUserCanAccessOrg).mockResolvedValue({
      role: "OWNER",
      workspaceType: "COMPANY",
    });

    const response = await handler(createEvent() as any);
    const body = JSON.parse(response.body);

    expect(response.statusCode).toBe(403);
    expect(body.error.code).toBe("ERROR_CABINET_WORKSPACE_REQUIRED");
    expect(CabinetDashboardService.getDashboard).not.toHaveBeenCalled();
  });
});
