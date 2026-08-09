import { handler as listDonorsHandler } from "@/lambda/domains/projects/get-donors";
import { handler as listProjectsHandler } from "@/lambda/domains/projects/get-projects";
import { AppError } from "@/lambda/shared/app-error";
import { ProductAccessRepository } from "@/lambda/shared/repositories/product-access-repository";
import { EffectiveOrganizationAccessService } from "@/lambda/shared/services/effective-organization-access-service";
import { DomainAuthorizationService } from "@/lambda/shared/services/domain-authorization-service";
import { ProductAccessService } from "@/lambda/shared/services/product-access-service";
import { ProjectService } from "@/lambda/domains/projects/services/project-service";

jest.mock("@/lambda/domains/projects/services/project-service", () => ({
  ProjectService: {
    listDonors: jest.fn(),
    listProjects: jest.fn(),
  },
}));

const activeAccountingAccess = {
  orgId: "org-123",
  productCode: "ACCOUNTING" as const,
  status: "ACTIVE" as const,
  createdAt: "2026-08-08T10:00:00.000Z",
  updatedAt: "2026-08-08T10:00:00.000Z",
};

const createEvent = (options: { authenticated?: boolean; routeKey?: string } = {}) => {
  const routeKey = options.routeKey ?? "GET /donors";

  return {
    version: "2.0",
    routeKey,
    rawPath: routeKey.replace(/^[A-Z]+ /, ""),
    rawQueryString: "",
    headers: { "accept-language": "en", "x-org-id": "org-123" },
    requestContext: {
      authorizer: {
        jwt: {
          claims: options.authenticated === false ? {} : { sub: "user-123" },
          scopes: [],
        },
      },
    },
    isBase64Encoded: false,
  };
};

describe("GET /donors ProductAccess pilot", () => {
  const originalPermission = process.env.ACCOUNTING_PERMISSION;

  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
    delete process.env.ACCOUNTING_PERMISSION;
    jest
      .spyOn(EffectiveOrganizationAccessService, "resolveAccess")
      .mockResolvedValue({
        accessMode: "READ_WRITE",
        accessSource: "DIRECT",
        orgId: "org-123",
        workspaceOrgId: "org-123",
      });
    jest.mocked(ProjectService.listDonors).mockResolvedValue([]);
    jest.mocked(ProjectService.listProjects).mockResolvedValue([]);
  });

  afterAll(() => {
    process.env.ACCOUNTING_PERMISSION = originalPermission;
  });

  test("rejects unauthenticated requests before membership or ProductAccess", async () => {
    const membership = jest.spyOn(
      EffectiveOrganizationAccessService,
      "resolveAccess",
    );
    const product = jest.spyOn(ProductAccessService, "requireActiveProductAccess");

    const response = await listDonorsHandler(
      createEvent({ authenticated: false }) as any,
    );

    expect(response.statusCode).toBe(401);
    expect(membership).not.toHaveBeenCalled();
    expect(product).not.toHaveBeenCalled();
    expect(ProjectService.listDonors).not.toHaveBeenCalled();
  });

  test("rejects non-members before ProductAccess", async () => {
    jest
      .spyOn(EffectiveOrganizationAccessService, "resolveAccess")
      .mockRejectedValue(new AppError(403, "ERROR_ORG_ACCESS_DENIED"));
    const product = jest.spyOn(ProductAccessService, "requireActiveProductAccess");

    const response = await listDonorsHandler(createEvent() as any);

    expect(response.statusCode).toBe(403);
    expect(product).not.toHaveBeenCalled();
    expect(ProjectService.listDonors).not.toHaveBeenCalled();
  });

  test.each([
    ["missing", null],
    ["inactive", { ...activeAccountingAccess, status: "INACTIVE" as const }],
  ])("denies %s ACCOUNTING product access", async (_case, productAccess) => {
    jest
      .spyOn(ProductAccessRepository, "getProductAccess")
      .mockResolvedValue(productAccess);
    jest.spyOn(console, "warn").mockImplementation(() => undefined);

    const response = await listDonorsHandler(createEvent() as any);
    const body = JSON.parse(response.body);

    expect(response.statusCode).toBe(403);
    expect(body.error.code).toBe("PRODUCT_ACCESS_REQUIRED");
    expect(ProjectService.listDonors).not.toHaveBeenCalled();
  });

  test("orders membership, ACCOUNTING access, PROJECTS permission, then handler logic", async () => {
    const membership = jest.spyOn(
      EffectiveOrganizationAccessService,
      "resolveAccess",
    );
    membership.mockResolvedValue({
      accessMode: "READ_WRITE",
      accessSource: "DIRECT",
      orgId: "org-123",
      permissions: ["PROJECTS_READ"],
      workspaceOrgId: "org-123",
    });
    const product = jest.spyOn(ProductAccessService, "requireActiveProductAccess");
    const productLookup = jest
      .spyOn(ProductAccessRepository, "getProductAccess")
      .mockResolvedValue(activeAccountingAccess);
    const permission = jest.spyOn(DomainAuthorizationService, "assertPermission");

    const response = await listDonorsHandler(createEvent() as any);

    expect(response.statusCode).toBe(200);
    expect(product).toHaveBeenCalledWith({
      action: "GET /donors",
      orgId: "org-123",
      productCode: "ACCOUNTING",
    });
    expect(permission).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: "org-123" }),
      "PROJECTS_READ",
    );
    expect(membership.mock.invocationCallOrder[0]).toBeLessThan(
      productLookup.mock.invocationCallOrder[0],
    );
    expect(productLookup.mock.invocationCallOrder[0]).toBeLessThan(
      permission.mock.invocationCallOrder[0],
    );
    expect(permission.mock.invocationCallOrder[0]).toBeLessThan(
      jest.mocked(ProjectService.listDonors).mock.invocationCallOrder[0],
    );
  });

  test("preserves existing RBAC denial after ACTIVE ProductAccess", async () => {
    jest
      .spyOn(ProductAccessRepository, "getProductAccess")
      .mockResolvedValue(activeAccountingAccess);
    jest
      .spyOn(DomainAuthorizationService, "assertPermission")
      .mockImplementation(() => {
        throw new AppError(403, "CABINET_DOSSIER_READ_ONLY");
      });
    jest.spyOn(console, "warn").mockImplementation(() => undefined);

    const response = await listDonorsHandler(createEvent() as any);

    expect(response.statusCode).toBe(403);
    expect(ProjectService.listDonors).not.toHaveBeenCalled();
  });

  test("does not accept a Treasury permission for the Projects pilot", async () => {
    jest
      .spyOn(EffectiveOrganizationAccessService, "resolveAccess")
      .mockResolvedValue({
        accessMode: "READ_WRITE",
        accessSource: "DIRECT",
        orgId: "org-123",
        permissions: ["TREASURY_READ"],
        workspaceOrgId: "org-123",
      });
    jest
      .spyOn(ProductAccessRepository, "getProductAccess")
      .mockResolvedValue(activeAccountingAccess);

    const response = await listDonorsHandler(createEvent() as any);

    expect(response.statusCode).toBe(403);
    expect(JSON.parse(response.body).error.code).toBe(
      "DOMAIN_PERMISSION_REQUIRED",
    );
    expect(ProjectService.listDonors).not.toHaveBeenCalled();
  });

  test("leaves a permission-only Projects route ProductAccess-non-enforcing", async () => {
    const product = jest.spyOn(ProductAccessService, "requireActiveProductAccess");
    const permission = jest.spyOn(DomainAuthorizationService, "assertPermission");

    const response = await listProjectsHandler(
      createEvent({ routeKey: "GET /projects" }) as any,
    );

    expect(response.statusCode).toBe(200);
    expect(product).not.toHaveBeenCalled();
    expect(permission).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: "org-123" }),
      "PROJECTS_READ",
    );
    expect(ProjectService.listProjects).toHaveBeenCalledWith("org-123");
  });
});
