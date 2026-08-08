import { APIGatewayProxyEventV2WithJWTAuthorizer } from "aws-lambda";
import { z } from "zod";
import type { CabinetRole } from "@liass-ohada/shared";
import type { AccountingAccessMode } from "@liass-ohada/shared";
import type { ProductCode } from "@liass-ohada/shared/shared";
import { isDomainPermission } from "../authorization/domain-permission";
import type { DomainPermission } from "../authorization/domain-permission";
import { AppError } from "../app-error";
import { I18nResolver } from "../i18n";
import { TenantAccessService } from "../services/tenant-access-service";
import { AccountingAuthorizationService } from "../services/accounting-authorization-service";
import { ProductAccessService } from "../services/product-access-service";
import { DomainAuthorizationService } from "../services/domain-authorization-service";

export { AppError };

// Note: On utilise l'interface avec JWT Authorizer par défaut
export interface HandlerContext {
  accountingAccessMode?: AccountingAccessMode;
  orgId: string;
  userId: string;
  role?: string;
  cabinetRole?: CabinetRole;
  cabinetId?: string;
  workspaceType?: "COMPANY" | "ACCOUNTING_FIRM";
  workspaceOrgId?: string;
  accountingFramework?: string;
  i18n: I18nResolver;
  event: APIGatewayProxyEventV2WithJWTAuthorizer;
}

export interface AuthenticatedHandlerContext {
  userId: string;
  i18n: I18nResolver;
  event: APIGatewayProxyEventV2WithJWTAuthorizer;
}

export interface ProductAuthorizationMetadata {
  action: string;
  permission: DomainPermission;
  productCode: ProductCode;
}

const sendResponse = (
  statusCode: number,
  body: any,
) => ({
  statusCode,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

const getHeader = (
  headers: Record<string, string | undefined> | undefined,
  name: string,
) => {
  if (!headers) {
    return undefined;
  }

  const target = name.toLowerCase();
  const found = Object.entries(headers).find(
    ([key]) => key.toLowerCase() === target,
  );

  return found?.[1];
};

const createTenantHandler = <T>(
  schema: z.ZodSchema<T>,
  logic: (data: T, context: HandlerContext) => Promise<any>,
  requiredWorkspaceType: "COMPANY" | "ACCOUNTING_FIRM" | "PLATFORM",
  productAuthorization?: ProductAuthorizationMetadata,
) => {
  return async (event: any) => {
    const i18n = new I18nResolver(event.headers["accept-language"] || "fr");

    try {
      const body = event.body ? JSON.parse(event.body) : {};
      const requestData = {
        ...body,
        ...(event.queryStringParameters || {}),
        ...(event.pathParameters || {}),
      };
      const {
        orgId: _ignoredOrgId,
        userId: _ignoredUserId,
        ...tenantSafeRequestData
      } = requestData;
      const validatedData = schema.parse(tenantSafeRequestData);

      const claims = event.requestContext?.authorizer?.jwt?.claims as any;
      const userId = claims?.sub;
      const orgId = getHeader(event.headers, "x-org-id");

      if (!userId) {
        throw new AppError(401, "ERROR_MISSING_USER_ID");
      }

      if (!orgId) {
        throw new AppError(400, "ERROR_MISSING_ORG_ID");
      }

      const workspaceOrgId = getHeader(event.headers, "x-workspace-org-id");
      const access =
        requiredWorkspaceType === "COMPANY"
          ? await (async () => {
              const permission =
                productAuthorization?.permission ??
                process.env.ACCOUNTING_PERMISSION;
              if (!isDomainPermission(permission)) {
                throw new AppError(500, "ACCOUNTING_PERMISSION_NOT_CONFIGURED");
              }
              const decision = await AccountingAuthorizationService.resolveAccess({
                orgId,
                userId,
                workspaceOrgId,
              });
              if (productAuthorization) {
                await ProductAccessService.requireActiveProductAccess({
                  action: productAuthorization.action,
                  orgId,
                  productCode: productAuthorization.productCode,
                });
              }
              DomainAuthorizationService.assertPermission(
                decision,
                permission,
              );
              return {
                accountingAccessMode: decision.accessMode,
                accountingFramework: decision.accountingFramework,
                cabinetId: decision.cabinetId,
                cabinetRole: decision.cabinetRole,
                role: decision.role,
                workspaceOrgId: decision.workspaceOrgId,
                workspaceType: "COMPANY" as const,
              };
            })()
          : await TenantAccessService.assertUserCanAccessOrg({
              orgId,
              userId,
            });

      if (
        requiredWorkspaceType === "ACCOUNTING_FIRM" &&
        access.workspaceType !== "ACCOUNTING_FIRM"
      ) {
        throw new AppError(403, "ERROR_CABINET_WORKSPACE_REQUIRED");
      }

      const result = await logic(validatedData, {
        orgId,
        accountingAccessMode: access.accountingAccessMode,
        userId,
        role: access.role,
        cabinetRole: access.cabinetRole,
        cabinetId: access.cabinetId,
        workspaceType: access.workspaceType,
        workspaceOrgId:
          "workspaceOrgId" in access ? access.workspaceOrgId : orgId,
        accountingFramework: access.accountingFramework,
        i18n,
        event,
      });

      return sendResponse(200, result);
    } catch (error: any) {
      // Correction : Zod utilise .issues
      if (error instanceof z.ZodError) {
        return sendResponse(400, {
          message: i18n.getMessage("ERROR_INVALID_INPUT"),
          errors: error.issues.map((e) => ({
            path: e.path.join("."),
            message: e.message,
          })),
        });
      }

      if (error instanceof AppError) {
        if (
          requiredWorkspaceType === "COMPANY" &&
          (error.messageCode.startsWith("CABINET_") ||
            error.messageCode === "ACCOUNTING_ACCESS_CONTEXT_INVALID")
        ) {
          console.warn("[ACCOUNTING_AUTHORIZATION_DENIED]", {
            code: error.messageCode,
            result: "DENIED",
            timestamp: new Date().toISOString(),
          });
        }
        return sendResponse(error.statusCode, {
          message: i18n.getMessage(error.messageCode, error.details),
          error: { code: error.messageCode },
          details: error.details,
        });
      }

      console.error("[CRITICAL_ERROR]:", error);
      return sendResponse(500, {
        message: i18n.getMessage("ERROR_INTERNAL_SERVER"),
      });
    }
  };
};

export const createHandler = <T>(
  schema: z.ZodSchema<T>,
  logic: (data: T, context: HandlerContext) => Promise<any>,
  productAuthorization?: ProductAuthorizationMetadata,
) =>
  createTenantHandler(schema, logic, "COMPANY", productAuthorization);

export const createCabinetHandler = <T>(
  schema: z.ZodSchema<T>,
  logic: (data: T, context: HandlerContext) => Promise<any>,
) => createTenantHandler(schema, logic, "ACCOUNTING_FIRM");

/** Tenant-scoped Platform Core handler. Verifies membership without product enforcement. */
export const createPlatformHandler = <T>(
  schema: z.ZodSchema<T>,
  logic: (data: T, context: HandlerContext) => Promise<any>,
) => createTenantHandler(schema, logic, "PLATFORM");

export const createAuthenticatedHandler = <T>(
  schema: z.ZodSchema<T>,
  logic: (data: T, context: AuthenticatedHandlerContext) => Promise<any>,
) => {
  return async (
      event: any,
  ) => {
    const i18n = new I18nResolver(getHeader(event.headers, "accept-language") || "fr");

    try {
      const body = event.body ? JSON.parse(event.body) : {};
      const requestData = {
        ...body,
        ...(event.queryStringParameters || {}),
        ...(event.pathParameters || {}),
      };
      const {
        orgId: _ignoredOrgId,
        userId: _ignoredUserId,
        ...authSafeRequestData
      } = requestData;
      const validatedData = schema.parse(authSafeRequestData);

      const claims = event.requestContext?.authorizer?.jwt?.claims as any;
      const userId = claims?.sub;

      if (!userId) {
        throw new AppError(401, "ERROR_MISSING_USER_ID");
      }

      const result = await logic(validatedData, {
        userId,
        i18n,
        event,
      });

      return sendResponse(200, result);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return sendResponse(400, {
          message: i18n.getMessage("ERROR_INVALID_INPUT"),
          errors: error.issues.map((e) => ({
            path: e.path.join("."),
            message: e.message,
          })),
        });
      }

      if (error instanceof AppError) {
        return sendResponse(error.statusCode, {
          message: i18n.getMessage(error.messageCode, error.details),
          error: { code: error.messageCode },
          details: error.details,
        });
      }

      console.error("[CRITICAL_ERROR]:", error);
      return sendResponse(500, {
        message: i18n.getMessage("ERROR_INTERNAL_SERVER"),
      });
    }
  };
};
