import type { APIGatewayProxyEventV2WithJWTAuthorizer } from "aws-lambda";
import { z } from "zod";
import { AppError } from "../../shared/app-error";
import {
  verifiedPlatformPrincipal,
  type PlatformPrincipal,
} from "../../shared/authorization/platform-admin";
import { I18nResolver } from "../../shared/i18n";
import { OrganizationFiscalRepository } from "../../shared/repositories/organization-fiscal-repository";
import { OrganizationFiscalVerificationService } from "../../shared/services/organization-fiscal-verification-service";
import { readCompanyFiscalProfile, selectCompanyFiscalRegime } from "../../shared/authority/fiscal-profiles/company-profile";
import { listFiscalRegimes } from "../../shared/authority/fiscal-profiles/profile";

export const fiscalEnvironmentForStage = (
  stage: PlatformPrincipal["stage"],
): "TEST" | "PRODUCTION" => (stage === "prod" ? "PRODUCTION" : "TEST");

function requireStageEnvironment(
  stage: PlatformPrincipal["stage"],
  value: unknown,
) {
  if (value !== fiscalEnvironmentForStage(stage)) {
    throw new AppError(400, "ERROR_INVALID_INPUT");
  }
}

/** Credentials require a dedicated sanitized boundary; never use a raw-error/request logging wrapper. */
export async function handler(event: APIGatewayProxyEventV2WithJWTAuthorizer) {
  const i18n = new I18nResolver(event.headers?.["accept-language"] ?? "fr");
  try {
    const principal = verifiedPlatformPrincipal(event);
    const orgId = Object.entries(event.headers ?? {}).find(
      ([key]) => key.toLowerCase() === "x-org-id",
    )?.[1];
    if (!orgId) throw new AppError(400, "ERROR_MISSING_ORG_ID");
    if (event.routeKey === "GET /me/organization/fiscality/profile") {
      const access = await OrganizationFiscalRepository.authorize(orgId, principal.sub, false, false);
      const current = await readCompanyFiscalProfile(orgId);
      return { statusCode: 200, body: JSON.stringify({ data: {
        country: current?.country ?? null,
        selected: current?.selected ?? null,
        regimes: listFiscalRegimes(current?.country),
        canManage: access.canManage,
      } }) };
    }
    if (event.routeKey === "PUT /me/organization/fiscality/profile") {
      await OrganizationFiscalRepository.authorize(orgId, principal.sub, true, false);
      let input: unknown;
      try { input = JSON.parse(event.body ?? "{}"); }
      catch { throw new AppError(400, "ERROR_INVALID_INPUT"); }
      const data = await selectCompanyFiscalRegime(
        orgId, input, OrganizationFiscalRepository.membershipCheck(orgId, principal.sub),
      );
      return { statusCode: 200, body: JSON.stringify({ data }) };
    }
    if (
      event.routeKey ===
      "POST /me/organization/fiscality/connections/{connectionId}/verification"
    ) {
      if (Object.keys(event.queryStringParameters ?? {}).length)
        throw new AppError(400, "ERROR_INVALID_INPUT");
      let input: unknown;
      try {
        input = JSON.parse(event.body ?? "{}");
      } catch {
        throw new AppError(400, "ERROR_INVALID_INPUT");
      }
      const fields = z.record(z.string(), z.unknown()).parse(input);
      requireStageEnvironment(principal.stage, fields.environment);
      const data = await new OrganizationFiscalVerificationService().verify(
        orgId,
        principal,
        { ...fields, connectionId: event.pathParameters?.connectionId },
      );
      return {
        statusCode: 200,
        body: JSON.stringify({
          data,
          message: i18n.getMessage(
            `PLATFORM_FISCAL_VERIFICATION_${data.status}`,
          ),
        }),
      };
    }
    if (event.routeKey === "GET /me/organization/fiscality/connections") {
      requireStageEnvironment(
        principal.stage,
        event.queryStringParameters?.environment,
      );
      const data = await OrganizationFiscalRepository.list(
        orgId,
        principal.sub,
        event.queryStringParameters ?? {},
      );
      return { statusCode: 200, body: JSON.stringify({ data }) };
    }
    const operations: Record<
      string,
      "CONFIGURE" | "STORE_CREDENTIAL" | "REVOKE_CREDENTIAL"
    > = {
      "PUT /me/organization/fiscality/connections/{connectionId}": "CONFIGURE",
      "PUT /me/organization/fiscality/connections/{connectionId}/credential":
        "STORE_CREDENTIAL",
      "DELETE /me/organization/fiscality/connections/{connectionId}/credential":
        "REVOKE_CREDENTIAL",
    };
    const kind = operations[event.routeKey];
    if (!kind) throw new AppError(404, "ERROR_NOT_FOUND");
    let body: unknown;
    try {
      body = JSON.parse(event.body ?? "{}");
    } catch {
      throw new AppError(400, "ERROR_INVALID_INPUT");
    }
    const fields = z.record(z.string(), z.unknown()).parse(body);
    requireStageEnvironment(principal.stage, fields.environment);
    const data = await OrganizationFiscalRepository.change(
      orgId,
      principal,
      kind,
      { ...fields, connectionId: event.pathParameters?.connectionId },
    );
    return {
      statusCode: 200,
      body: JSON.stringify({
        data,
        message: i18n.getMessage("PLATFORM_FISCAL_SAVED"),
      }),
    };
  } catch (error) {
    const code =
      error instanceof AppError
        ? error.messageCode
        : error instanceof z.ZodError
          ? "ERROR_INVALID_INPUT"
          : "PLATFORM_FISCAL_UNAVAILABLE";
    const statusCode =
      error instanceof AppError
        ? error.statusCode
        : error instanceof z.ZodError
          ? 400
          : 503;
    return {
      statusCode,
      body: JSON.stringify({ message: i18n.getMessage(code), error: { code } }),
    };
  }
}
