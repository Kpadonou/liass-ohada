import { handler as listDonorsHandler } from "@/lambda/domains/projects/get-donors";
import { handler as listProjectsHandler } from "@/lambda/domains/projects/get-projects";
import { AppError } from "@/lambda/shared/app-error";
import { ProductAccessRepository } from "@/lambda/shared/repositories/product-access-repository";
import { AccountingAuthorizationService } from "@/lambda/shared/services/accounting-authorization-service";
import { DomainAuthorizationService } from "@/lambda/shared/services/domain-authorization-service";
import { ProductAccessService } from "@/lambda/shared/services/product-access-service";
import { ProjectService } from "@/lambda/shared/services/project-service";

jest.mock("@/lambda/shared/services/project-service", () => ({
  ProjectService: {
    listDonors: jest.fn(),
    listProjects: jest.fn(),
  },
}));

const activeProjectsAccess = {
  orgId: "org-123",
  productCode: "PROJECTS" as const,
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
    process.env.ACCOUNTING_PERMISSION = "ACCOUNTING_READ";
    jest
      .spyOn(AccountingAuthorizationService, "resolveAccess")
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
    const membership = jest.spyOn(AccountingAuthorizationService, "resolveAccess");
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
      .spyOn(AccountingAuthorizationService, "resolveAccess")
      .mockRejectedValue(new AppError(403, "ERROR_ORG_ACCESS_DENIED"));
    const product = jest.spyOn(ProductAccessService, "requireActiveProductAccess");

    const response = await listDonorsHandler(createEvent() as any);

    expect(response.statusCode).toBe(403);
    expect(product).not.toHaveBeenCalled();
    expect(ProjectService.listDonors).not.toHaveBeenCalled();
  });

  test.each([
    ["missing", null],
    ["inactive", { ...activeProjectsAccess, status: "INACTIVE" as const }],
  ])("denies %s PROJECTS access", async (_case, productAccess) => {
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

  test("orders membership, PROJECTS access, read permission, then handler logic", async () => {
    const membership = jest.spyOn(AccountingAuthorizationService, "resolveAccess");
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
      .mockResolvedValue(activeProjectsAccess);
    const permission = jest.spyOn(DomainAuthorizationService, "assertPermission");

    const response = await listDonorsHandler(createEvent() as any);

    expect(response.statusCode).toBe(200);
    expect(product).toHaveBeenCalledWith({
      action: "GET /donors",
      orgId: "org-123",
      productCode: "PROJECTS",
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
      .mockResolvedValue(activeProjectsAccess);
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
      .spyOn(AccountingAuthorizationService, "resolveAccess")
      .mockResolvedValue({
        accessMode: "READ_WRITE",
        accessSource: "DIRECT",
        orgId: "org-123",
        permissions: ["TREASURY_READ"],
        workspaceOrgId: "org-123",
      });
    jest
      .spyOn(ProductAccessRepository, "getProductAccess")
      .mockResolvedValue(activeProjectsAccess);

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
