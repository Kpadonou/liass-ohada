import { TenantAccessService } from "@/lambda/shared/services/tenant-access-service";
import { handler } from "@/lambda/domains/identity/get-workspaces";

jest.mock("@/lambda/shared/services/tenant-access-service", () => ({
  TenantAccessService: {
    getUserWorkspaces: jest.fn(),
  },
}));

const createEvent = (claims = { sub: "user-123" }) => ({
  version: "2.0",
  routeKey: "GET /me/workspaces",
  rawPath: "/me/workspaces",
  rawQueryString: "",
  headers: { "accept-language": "en" },
  requestContext: {
    http: {
      method: "GET",
      path: "/me/workspaces",
      protocol: "HTTP/1.1",
      sourceIp: "127.0.0.1",
      userAgent: "jest",
    },
    authorizer: {
      jwt: {
        claims,
        scopes: [],
      },
    },
  },
  isBase64Encoded: false,
});

describe("GET /me/workspaces", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("returns frontend-safe workspaces for the authenticated user", async () => {
    jest.mocked(TenantAccessService.getUserWorkspaces).mockResolvedValue([
      {
        orgId: "org-test",
        role: "ACCOUNTANT",
        cabinetId: "cab-001",
        accessSource: "DIRECT",
        displayName: "Demo Organization",
      },
    ]);

    const response = await handler(createEvent() as any);
    const body = JSON.parse(response.body);

    expect(response.statusCode).toBe(200);
    expect(TenantAccessService.getUserWorkspaces).toHaveBeenCalledWith("user-123");
    expect(body).toEqual({
      workspaces: [
        {
          orgId: "org-test",
          role: "ACCOUNTANT",
          cabinetId: "cab-001",
          accessSource: "DIRECT",
          displayName: "Demo Organization",
        },
      ],
    });
  });
});
