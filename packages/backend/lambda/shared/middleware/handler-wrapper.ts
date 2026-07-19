import { APIGatewayProxyEventV2WithJWTAuthorizer } from "aws-lambda";
import { z } from "zod";
import type { CabinetRole } from "@liass-ohada/shared";
import { AppError } from "../app-error";
import { I18nResolver } from "../i18n";
import { TenantAccessService } from "../services/tenant-access-service";

export { AppError };

// Note: On utilise l'interface avec JWT Authorizer par défaut
export interface HandlerContext {
  orgId: string;
  userId: string;
  role?: string;
  cabinetRole?: CabinetRole;
  cabinetId?: string;
  workspaceType?: "COMPANY" | "ACCOUNTING_FIRM";
  accountingFramework?: string;
  i18n: I18nResolver;
  event: APIGatewayProxyEventV2WithJWTAuthorizer;
}

export interface AuthenticatedHandlerContext {
  userId: string;
  i18n: I18nResolver;
  event: APIGatewayProxyEventV2WithJWTAuthorizer;
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
  requiredWorkspaceType: "COMPANY" | "ACCOUNTING_FIRM",
) => {
  return async (
      event: any,
  ) => {
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

      const access = await TenantAccessService.assertUserCanAccessOrg({
        orgId,
        userId,
      });

      if (access.workspaceType !== requiredWorkspaceType) {
        throw new AppError(
          403,
          requiredWorkspaceType === "ACCOUNTING_FIRM"
            ? "ERROR_CABINET_WORKSPACE_REQUIRED"
            : "ERROR_ACCOUNTING_DOSSIER_REQUIRED",
        );
      }

      const result = await logic(validatedData, {
        orgId,
        userId,
        role: access.role,
        cabinetRole: access.cabinetRole,
        cabinetId: access.cabinetId,
        workspaceType: access.workspaceType,
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
        return sendResponse(error.statusCode, {
          message: i18n.getMessage(error.messageCode, error.details),
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
) => createTenantHandler(schema, logic, "COMPANY");

export const createCabinetHandler = <T>(
  schema: z.ZodSchema<T>,
  logic: (data: T, context: HandlerContext) => Promise<any>,
) => createTenantHandler(schema, logic, "ACCOUNTING_FIRM");

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
