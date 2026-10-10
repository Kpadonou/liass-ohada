import { randomUUID } from "node:crypto";
import { AppError } from "@/lambda/shared/app-error";
import { DOMAIN_PERMISSIONS, FISCAL_COMPLIANCE_PERMISSIONS, DomainPermission } from "@/lambda/shared/authorization/domain-permission";
import { DomainAuthorizationService } from "@/lambda/shared/services/domain-authorization-service";
import { EffectiveOrganizationAccessService } from "@/lambda/shared/services/effective-organization-access-service";
import { ProductAccessService } from "@/lambda/shared/services/product-access-service";
import { FiscalService } from "@/lambda/domains/fiscal-compliance/core/fiscal-service";
import { handler as getProfile } from "@/lambda/domains/fiscal-compliance/handlers/get-profile";
import { handler as putProfile } from "@/lambda/domains/fiscal-compliance/handlers/put-profile";
import { handler as createConnection } from "@/lambda/domains/fiscal-compliance/handlers/create-connection";
import { handler as updateConnection } from "@/lambda/domains/fiscal-compliance/handlers/update-connection";
import { handler as getConnection } from "@/lambda/domains/fiscal-compliance/handlers/get-connection";
import { handler as listConnections } from "@/lambda/domains/fiscal-compliance/handlers/list-connections";
import { handler as prepare } from "@/lambda/domains/fiscal-compliance/handlers/prepare-certification";
import { handler as getCertification } from "@/lambda/domains/fiscal-compliance/handlers/get-certification";
import { handler as revise } from "@/lambda/domains/fiscal-compliance/handlers/revise-preparation";
import { handler as readiness } from "@/lambda/domains/fiscal-compliance/handlers/evaluate-readiness";
import { timestamp, request } from "./fixtures";

const event = (body: Record<string, unknown> = {}) => ({ headers: { "x-org-id": "dossier-1", "x-workspace-org-id": "workspace-1", "accept-language": "en" },
  requestContext: { authorizer: { jwt: { claims: { sub: "verified-user" } } } }, body: JSON.stringify(body) });
const sourceIdentity = { environment: "TEST", sourceDocumentType: "INVOICE", sourceDocumentId: "invoice-1" };
const cases = [
  [getProfile, {}, "getProfile", "READ"], [putProfile, { expectedVersion: 0 }, "putProfile", "WRITE"],
  [createConnection, { environment: "TEST" }, "createConnection", "WRITE"],
  [updateConnection, { environment: "TEST", connectionId: "connection-1", expectedVersion: 1 }, "updateConnection", "WRITE"],
  [getConnection, { environment: "TEST", connectionId: "connection-1" }, "getConnection", "READ"],
  [listConnections, { environment: "TEST" }, "listConnections", "READ"],
  [prepare, request(), "prepare", "WRITE"], [getCertification, sourceIdentity, "getCertification", "READ"],
  [revise, { ...sourceIdentity, expectedVersion: 1, clientRequestId: randomUUID(), preparation: { lines: [] } }, "revise", "WRITE"],
  [readiness, request(), "readiness", "READ"],
] as const;
beforeEach(() => {
  jest.restoreAllMocks();
  jest.spyOn(EffectiveOrganizationAccessService, "resolveAccess").mockResolvedValue({ accessMode: "READ_WRITE", accessSource: "DIRECT",
    orgId: "dossier-1", workspaceOrgId: "workspace-1", permissions: FISCAL_COMPLIANCE_PERMISSIONS });
  jest.spyOn(ProductAccessService, "requireActiveProductAccess").mockResolvedValue({ orgId: "dossier-1", productCode: "SALES", status: "ACTIVE", createdAt: timestamp, updatedAt: timestamp });
});
test.each(cases)("every route enforces owning Fiscal Compliance permission and SALES independently: %s", async (handler, body, method, permission) => {
  const service = jest.spyOn(FiscalService, method).mockResolvedValue(null as never);
  const response = await handler(event({ ...body, orgId: "forged-org", userId: "forged-user" }));
  expect(response.statusCode).toBe(200);
  expect(service.mock.calls[0][0]).toBe("dossier-1");
  expect(EffectiveOrganizationAccessService.resolveAccess).toHaveBeenCalledWith({ orgId: "dossier-1", userId: "verified-user", workspaceOrgId: "workspace-1" });
  expect(ProductAccessService.requireActiveProductAccess).toHaveBeenCalledWith(expect.objectContaining({ orgId: "dossier-1", productCode: "SALES" }));
  jest.mocked(EffectiveOrganizationAccessService.resolveAccess).mockResolvedValue({ accessMode: "READ_WRITE", accessSource: "DIRECT",
    orgId: "dossier-1", workspaceOrgId: "workspace-1", permissions: ["SALES_READ", "SALES_WRITE"] });
  expect((await handler(event(body))).statusCode).toBe(403);
  expect(service).toHaveBeenCalledTimes(1);
  jest.mocked(EffectiveOrganizationAccessService.resolveAccess).mockResolvedValue({ accessMode: "READ_WRITE", accessSource: "DIRECT",
    orgId: "dossier-1", workspaceOrgId: "workspace-1", permissions: [permission === "READ" ? "FISCAL_COMPLIANCE_WRITE" : "FISCAL_COMPLIANCE_READ"] });
  expect((await handler(event(body))).statusCode).toBe(403);
});
test.each(["MISSING", "INACTIVE"])("SALES %s denies Fiscal permission holder before business service", async () => {
  const service = jest.spyOn(FiscalService, "getProfile");
  jest.mocked(ProductAccessService.requireActiveProductAccess).mockRejectedValue(new AppError(403, "PRODUCT_ACCESS_REQUIRED"));
  expect((await getProfile(event())).statusCode).toBe(403);
  expect(service).not.toHaveBeenCalled();
});
test("identity and membership remain required", async () => {
  expect((await getProfile({ ...event(), requestContext: {} })).statusCode).toBe(401);
  jest.mocked(EffectiveOrganizationAccessService.resolveAccess).mockRejectedValue(new AppError(403, "DOMAIN_PERMISSION_REQUIRED"));
  expect((await getProfile(event())).statusCode).toBe(403);
  expect(ProductAccessService.requireActiveProductAccess).not.toHaveBeenCalled();
});
test("OWNER grants are explicit; all other direct roles, unknown roles and every cabinet access mode retain no fiscal grant", () => {
  expect(DomainAuthorizationService.permissionsForDirectOrganizationRole("OWNER")).toEqual(DOMAIN_PERMISSIONS.filter(permission => !permission.startsWith("RESTAURANTS_")));
  for (const role of ["ACCOUNTANT", "ADMIN", "MEMBER", "READER", "CABINET_ADMIN", "SUPERVISOR", "COLLABORATOR", undefined]) {
    for (const permission of FISCAL_COMPLIANCE_PERMISSIONS) expect(DomainAuthorizationService.permissionsForDirectOrganizationRole(role)).not.toContain(permission);
  }
  for (const mode of ["READ_ONLY", "READ_WRITE"] as const) {
    for (const permission of FISCAL_COMPLIANCE_PERMISSIONS) expect(DomainAuthorizationService.permissionsForAccessMode(mode)).not.toContain(permission);
  }
});
test.each(["CABINET_ADMIN", "SUPERVISOR", "COLLABORATOR", "READER"] as const)("selected dossier has no cabinet bypass for %s", async cabinetRole => {
  jest.mocked(EffectiveOrganizationAccessService.resolveAccess).mockResolvedValue({ accessMode: "READ_WRITE", accessSource: "CABINET",
    cabinetRole, orgId: "dossier-1", workspaceOrgId: "workspace-1", permissions: DomainAuthorizationService.permissionsForAccessMode("READ_WRITE") });
  expect((await getProfile(event())).statusCode).toBe(403);
});
test("ACCOUNTING entitlement alone cannot authorize and does not grant Fiscal RBAC", async () => {
  jest.mocked(EffectiveOrganizationAccessService.resolveAccess).mockResolvedValue({ accessMode: "READ_WRITE", accessSource: "DIRECT",
    orgId: "dossier-1", workspaceOrgId: "workspace-1", permissions: ["ACCOUNTING_READ", "ACCOUNTING_WRITE"] });
  expect((await getProfile(event())).statusCode).toBe(403);
});
