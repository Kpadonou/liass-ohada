import { handler as listHandler } from "@/lambda/domains/identity/list-cabinet-dossiers";
import { CabinetDossierService } from "@/lambda/shared/services/cabinet-dossier-service";
import { TenantAccessService } from "@/lambda/shared/services/tenant-access-service";

jest.mock("@/lambda/shared/services/cabinet-dossier-service", () => ({
  CabinetDossierService: {
    listClientDossiers: jest.fn(),
  },
}));

jest.mock("@/lambda/shared/services/tenant-access-service", () => ({
  TenantAccessService: {
    assertUserCanAccessOrg: jest.fn(),
  },
}));

const createEvent = ({
  headers = { "accept-language": "en", "x-org-id": "org-cabinet" },
  claims = { sub: "user-123" },
}: {
  headers?: Record<string, string>;
  claims?: Record<string, string>;
} = {}) => ({
  version: "2.0",
  routeKey: "GET /cabinet/dossiers",
  rawPath: "/cabinet/dossiers",
  rawQueryString: "",
  headers,
  requestContext: {
    http: {
      method: "GET",
      path: "/cabinet/dossiers",
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

describe("cabinet dossier handlers", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("requires x-org-id before listing cabinet dossiers", async () => {
    const response = await listHandler(
      createEvent({ headers: { "accept-language": "en" } }) as any,
    );
    const body = JSON.parse(response.body);

    expect(response.statusCode).toBe(400);
    expect(body.message.code).toBe("ERROR_MISSING_ORG_ID");
    expect(CabinetDossierService.listClientDossiers).not.toHaveBeenCalled();
  });

  test("passes verified tenant context to the cabinet dossier service", async () => {
    jest.mocked(TenantAccessService.assertUserCanAccessOrg).mockResolvedValue({
      role: "OWNER",
      cabinetId: "cab-123",
      workspaceType: "ACCOUNTING_FIRM",
    });
    jest.mocked(CabinetDossierService.listClientDossiers).mockResolvedValue({
      dossiers: [],
    });

    const response = await listHandler(createEvent() as any);

    expect(response.statusCode).toBe(200);
    expect(TenantAccessService.assertUserCanAccessOrg).toHaveBeenCalledWith({
      orgId: "org-cabinet",
      userId: "user-123",
    });
    expect(CabinetDossierService.listClientDossiers).toHaveBeenCalledWith({
      orgId: "org-cabinet",
      userId: "user-123",
      cabinetId: "cab-123",
      workspaceType: "ACCOUNTING_FIRM",
    });
  });
});
