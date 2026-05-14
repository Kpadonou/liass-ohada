import {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyResultV2,
} from "aws-lambda";
import { z } from "zod";
import { I18nResolver } from "../i18n";

export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly messageCode: string,
    public readonly details?: any,
  ) {
    super(messageCode);
    this.name = "AppError";
  }
}

// Note: On utilise l'interface avec JWT Authorizer par défaut
export interface HandlerContext {
  orgId: string;
  userId: string;
  i18n: I18nResolver;
  event: APIGatewayProxyEventV2WithJWTAuthorizer;
}

const sendResponse = (
  statusCode: number,
  body: any,
): APIGatewayProxyResultV2 => ({
  statusCode,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export const createHandler = <T>(
  schema: z.ZodSchema<T>,
  logic: (data: T, context: HandlerContext) => Promise<any>,
) => {
  return async (
    event: APIGatewayProxyEventV2WithJWTAuthorizer,
  ): Promise<APIGatewayProxyResultV2> => {
    const i18n = new I18nResolver(event.headers["accept-language"] || "fr");

    try {
      const body = event.body ? JSON.parse(event.body) : {};
      const validatedData = schema.parse(body);

      const claims = event.requestContext?.authorizer?.jwt?.claims as any;
      const orgId = claims?.orgId;
      const userId = claims?.sub;

      if (!orgId) {
        throw new AppError(401, "ERROR_MISSING_ORG_ID");
      }

      if (!userId) {
        throw new AppError(401, "ERROR_MISSING_USER_ID");
      }

      const result = await logic(validatedData, { orgId, userId, i18n, event });

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
