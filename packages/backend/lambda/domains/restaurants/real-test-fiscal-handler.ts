import type { APIGatewayProxyEventV2WithJWTAuthorizer, DynamoDBStreamEvent } from "aws-lambda";
import { processFiscalIntentStream } from "./fiscal-intent-stream";
import { recoverBlockedFiscalWork, fiscalWorkRecoveryRequest, completeConfirmedFiscalWork, recoverBoundFiscalWork } from "./fiscal-work-recovery";
import { AppError } from "@/lambda/shared/app-error";
import { realFiscalTestEnabled } from "../fiscal-compliance/core/test-execution";
import { BeninEMecefTestAdapter } from "../fiscal-compliance/providers/benin-emecef/benin-emecef-test-adapter";
import { realTestConfigurationSchema } from "./benin-real-test-workflow";
import { FiscalTestExecutionAuthorizationService } from "@/lambda/shared/services/fiscal-test-execution-authorization-service";
import { OrganizationFiscalRepository } from "@/lambda/shared/repositories/organization-fiscal-repository";
import { RestaurantFiscalApplicationService } from "./fiscal-application-service";
import { restaurantFiscalHandler } from "./fiscal-handler";
import { restaurantFiscalAdjudicationHandler } from "./fiscal-adjudication-handler";
import { RESTAURANT_FISCAL_ROUTES } from "./fiscal-routes";
import { RESTAURANT_FISCAL_AUTHORIZATION_PREPARATION_ROUTE } from "./fiscal-authorization-preparation-routes";
import { restaurantFiscalAuthorizationPreparationHandler } from "./fiscal-authorization-preparation-handler";
/** JWT middleware derives actor and tenant. Credentials remain in Platform SSM;
 * this handler obtains them only after an immutable source-bound authorization. */
export const realTestFiscalService = new RestaurantFiscalApplicationService(async (context, request, sourceDigest) => {
  try {
    const binding = { orgId: context.orgId, outletId: request.outletId, operatorUserId: context.userId,
      sessionId: request.sessionId, invoiceId: request.invoiceId, creditNoteId: request.creditNoteId, sourceDigest };
    const authorization = await FiscalTestExecutionAuthorizationService.readBound(binding);
    const stage = process.env.STAGE === "test" ? "test" : "dev";
    const credential = await OrganizationFiscalRepository.readAuthorizedExecutionCredential(context.orgId, stage, authorization.connectionId);
    if (!credential.connection.data.nim || !credential.connection.data.taxpayerIfu) throw new Error();
    const config = realTestConfigurationSchema.parse({ orgId: context.orgId, operatorUserId: context.userId,
      outletId: request.outletId, sessionId: request.sessionId, invoiceId: request.invoiceId,
      ...(request.creditNoteId ? { creditNoteId: request.creditNoteId } : {}), token: credential.token,
      ifu: credential.connection.data.taxpayerIfu, nim: credential.connection.data.nim, sourceDigest,
      classifications: [], mapping: authorization.fiscalMapping, expectedFiscalTotals: authorization.expectedFiscalTotals });
    return { realConfiguration: config, classifications: config.classifications, mapping: config.mapping,
      adapter: new BeninEMecefTestAdapter(), credential: () => config.token,
      executionAuthorize: async (action) => { await FiscalTestExecutionAuthorizationService.resolveAndConsume(binding, action); } };
  } catch { throw new AppError(403, "DOMAIN_PERMISSION_REQUIRED"); }
}, true);
export function handler(event: APIGatewayProxyEventV2WithJWTAuthorizer): Promise<{ statusCode: number; body: string }>;
export function handler(event: DynamoDBStreamEvent): Promise<{ batchItemFailures: { itemIdentifier: string }[] }>;
export function handler(event: { type: "RECOVER_FISCAL_WORK_V1" | "COMPLETE_CONFIRMED_FISCAL_WORK_V1"; orgId: string; outletId: string; sessionId: string; invoiceId: string }): ReturnType<typeof recoverBlockedFiscalWork> | ReturnType<typeof completeConfirmedFiscalWork>;
export function handler(event: { type: "RECOVER_BOUND_FISCAL_WORK_V1"; orgId: string; outletId: string; sessionId: string; invoiceId: string; expectedClaimVersion: number; expectedBindingDigest: string }): ReturnType<typeof recoverBoundFiscalWork>;
export async function handler(event: APIGatewayProxyEventV2WithJWTAuthorizer | DynamoDBStreamEvent | { type: "RECOVER_FISCAL_WORK_V1" | "COMPLETE_CONFIRMED_FISCAL_WORK_V1" | "RECOVER_BOUND_FISCAL_WORK_V1"; orgId: string; outletId: string; sessionId: string; invoiceId: string; expectedClaimVersion?: number; expectedBindingDigest?: string }) {
  if ("type" in event && event.type === "COMPLETE_CONFIRMED_FISCAL_WORK_V1") return completeConfirmedFiscalWork(event);
  if ("type" in event && event.type === "RECOVER_BOUND_FISCAL_WORK_V1") return recoverBoundFiscalWork(event);
  if ("type" in event) return recoverBlockedFiscalWork(fiscalWorkRecoveryRequest.parse(event));
  if ("Records" in event) return processFiscalIntentStream(event);
  if (event.routeKey === `${RESTAURANT_FISCAL_AUTHORIZATION_PREPARATION_ROUTE.method} ${RESTAURANT_FISCAL_AUTHORIZATION_PREPARATION_ROUTE.path}`)
    return restaurantFiscalAuthorizationPreparationHandler(event);
  const route = RESTAURANT_FISCAL_ROUTES.find(r => `${r.method} ${r.path}` === event.routeKey);
  if (!route) return { statusCode: 404, body: "{}" };
  if (route.operation === "adjudicate")
    return restaurantFiscalAdjudicationHandler()(event);
  if (!realFiscalTestEnabled() && route.operation !== "status" && route.operation !== "confirmedResult") return { statusCode: 403, body: JSON.stringify({ error: { code: "DOMAIN_PERMISSION_REQUIRED" } }) };
  return restaurantFiscalHandler(route.name, realTestFiscalService, true)(event);
}
