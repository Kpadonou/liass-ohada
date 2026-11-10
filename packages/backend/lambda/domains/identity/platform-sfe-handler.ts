import { assertFiscalOrganization } from "../../shared/authorization/fiscal-organization";
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from "aws-lambda";
import { z } from "zod";
import { PutSfeApprovalRequestSchema, SfeApprovalViewSchema } from "@liass-ohada/shared/shared";
import { AppError } from "../../shared/app-error";
import { I18nResolver } from "../../shared/i18n";
import { verifiedPlatformPrincipal } from "../../shared/authorization/platform-admin";
import { PlatformSfeRepository } from "../../shared/repositories/platform-sfe-repository";
import { TenantAccessService } from "../../shared/services/tenant-access-service";

/** Dedicated boundary: never log raw errors, requests or authorizer claims. */
export async function handler(event: APIGatewayProxyEventV2WithJWTAuthorizer) {
  const i18n = new I18nResolver(event.headers?.["accept-language"] ?? "fr");
  try {
    const principal = verifiedPlatformPrincipal(event);
    if (event.routeKey === "PUT /platform/fiscality/sfe-approval") {
      let input: unknown;
      try { input = JSON.parse(event.body ?? "{}"); }
      catch { throw new AppError(400, "ERROR_INVALID_INPUT"); }
      const request = PutSfeApprovalRequestSchema.parse(input);
      const approval = await PlatformSfeRepository.update(principal, request);
      return { statusCode: 200, body: JSON.stringify({ data: SfeApprovalViewSchema.parse({ status: "REGISTERED", approval }) }) };
    }
    if (event.routeKey !== "GET /me/organization/fiscality/sfe-approval")
      throw new AppError(404, "ERROR_NOT_FOUND");
    const orgId = Object.entries(event.headers ?? {}).find(([key]) => key.toLowerCase() === "x-org-id")?.[1];
    if (!orgId) throw new AppError(400, "ERROR_MISSING_ORG_ID");
    const access = await TenantAccessService.assertUserCanAccessOrg({ orgId, userId: principal.sub });
    if (access.workspaceType !== "COMPANY" || access.accessSource !== "DIRECT")
      throw new AppError(403, "PLATFORM_FISCAL_FORBIDDEN");
    await assertFiscalOrganization(orgId);
    return { statusCode: 200, body: JSON.stringify({ data: SfeApprovalViewSchema.parse(await PlatformSfeRepository.read(principal.stage)) }) };
  } catch (error) {
    const code = error instanceof AppError ? error.messageCode : error instanceof z.ZodError ? "ERROR_INVALID_INPUT" : "PLATFORM_SFE_UNAVAILABLE";
    const statusCode = error instanceof AppError ? error.statusCode : error instanceof z.ZodError ? 400 : 503;
    return { statusCode, body: JSON.stringify({ message: i18n.getMessage(code), error: { code } }) };
  }
}
