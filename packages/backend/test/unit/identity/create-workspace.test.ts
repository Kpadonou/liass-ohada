import { OnboardingService } from "@/lambda/shared/services/onboarding-service";
import { handler } from "@/lambda/domains/identity/create-workspace";

jest.mock("@/lambda/shared/services/onboarding-service", () => ({
  OnboardingService: {
    createInitialWorkspace: jest.fn(),
  },
}));

const createEvent = ({
  body = {
    workspaceType: "COMPANY",
    organizationName: "Demo SARL",
    country: "BJ",
    accountingFramework: "SYSCOHADA_REVISED",
  },
  claims = { sub: "user-123" },
}: {
  body?: Record<string, unknown>;
  claims?: Record<string, string>;
} = {}) => ({
  version: "2.0",
  routeKey: "POST /me/workspaces",
  rawPath: "/me/workspaces",
  rawQueryString: "",
  headers: { "accept-language": "en" },
  requestContext: {
    http: {
      method: "POST",
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
  body: JSON.stringify(body),
  isBase64Encoded: false,
});

describe("POST /me/workspaces", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("creates the initial workspace from Cognito-authenticated context without x-org-id", async () => {
    jest.mocked(OnboardingService.createInitialWorkspace).mockResolvedValue({
      organization: {
        orgId: "org-created",
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
        orgId: "org-created",
        role: "OWNER",
        accessSource: "DIRECT",
        displayName: "Demo SARL",
        workspaceType: "COMPANY",
        status: "ACTIVE",
        country: "BJ",
        accountingFramework: "SYSCOHADA_REVISED",
      },
      activeOrgId: "org-created",
    });

    const response = await handler(createEvent() as any);
    const body = JSON.parse(response.body);

    expect(response.statusCode).toBe(200);
    expect(OnboardingService.createInitialWorkspace).toHaveBeenCalledWith(
      "user-123",
      {
        workspaceType: "COMPANY",
        organizationName: "Demo SARL",
        country: "BJ",
        accountingFramework: "SYSCOHADA_REVISED",
      },
    );
    expect(body.activeOrgId).toBe("org-created");
  });

  test("strictly rejects unknown client supplied role and cabinet identifiers", async () => {
    const response = await handler(
      createEvent({
        body: {
          workspaceType: "COMPANY",
          organizationName: "Demo SARL",
          country: "BJ",
          accountingFramework: "SYSCOHADA_REVISED",
          role: "ADMIN",
          ownerUserId: "attacker-user",
          cabinetId: "attacker-cabinet",
        },
      }) as any,
    );
    const body = JSON.parse(response.body);

    expect(response.statusCode).toBe(400);
    expect(body.message.code).toBe("ERROR_INVALID_INPUT");
    expect(OnboardingService.createInitialWorkspace).not.toHaveBeenCalled();
  });

  test("stripped orgId and userId cannot influence generated tenant or owner identity", async () => {
    jest.mocked(OnboardingService.createInitialWorkspace).mockResolvedValue({
      organization: {
        orgId: "org-server",
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
        orgId: "org-server",
        role: "OWNER",
        accessSource: "DIRECT",
        displayName: "Demo SARL",
        workspaceType: "COMPANY",
        status: "ACTIVE",
        country: "BJ",
        accountingFramework: "SYSCOHADA_REVISED",
      },
      activeOrgId: "org-server",
    });

    const response = await handler(
      createEvent({
        body: {
          workspaceType: "COMPANY",
          organizationName: "Demo SARL",
          country: "BJ",
          accountingFramework: "SYSCOHADA_REVISED",
          orgId: "attacker-org",
          userId: "attacker-user",
        },
      }) as any,
    );

    expect(response.statusCode).toBe(200);
    expect(OnboardingService.createInitialWorkspace).toHaveBeenCalledWith(
      "user-123",
      {
        workspaceType: "COMPANY",
        organizationName: "Demo SARL",
        country: "BJ",
        accountingFramework: "SYSCOHADA_REVISED",
      },
    );
  });

  test("rejects requests without Cognito subject", async () => {
    const response = await handler(createEvent({ claims: {} }) as any);
    const body = JSON.parse(response.body);

    expect(response.statusCode).toBe(401);
    expect(body.message.code).toBe("ERROR_MISSING_USER_ID");
  });
});
