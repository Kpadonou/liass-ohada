import { TenantAccessService } from "@/lambda/shared/services/tenant-access-service";
import { UserProfileService } from "@/lambda/shared/services/user-profile-service";
import { handler } from "@/lambda/domains/identity/get-workspaces";

jest.mock("@/lambda/shared/services/tenant-access-service", () => ({
  TenantAccessService: {
    getUserWorkspaces: jest.fn(),
  },
}));
jest.mock("@/lambda/shared/services/user-profile-service", () => ({
  UserProfileService: { ensureSynchronized: jest.fn().mockResolvedValue({}) },
}));

const createEvent = (claims = {
  sub: "user-123",
  email: "owner@example.com",
  email_verified: "true",
}) => ({
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
    expect(UserProfileService.ensureSynchronized).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-123", email: "owner@example.com" }),
    );
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
