import type { APIGatewayProxyEventV2WithJWTAuthorizer } from "aws-lambda";
import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { AppError } from "@/lambda/shared/app-error";
import { realFiscalTestEnabled } from "../fiscal-compliance/core/test-execution";
import { BeninEMecefTestAdapter } from "../fiscal-compliance/providers/benin-emecef/benin-emecef-test-adapter";
import { realTestConfigurationSchema } from "./benin-real-test-workflow";
import { RestaurantFiscalApplicationService } from "./fiscal-application-service";
import { restaurantFiscalHandler } from "./fiscal-handler";
import { restaurantFiscalAdjudicationHandler } from "./fiscal-adjudication-handler";
import { RESTAURANT_FISCAL_ROUTES } from "./fiscal-routes";
const secrets = new SecretsManagerClient({ maxAttempts: 1 });
/** JWT middleware derives actor and tenant. Secret configuration is never accepted in a request. */
const service = new RestaurantFiscalApplicationService(async (context, request) => {
  try {
    const result = await secrets.send(new GetSecretValueCommand({ SecretId: process.env.FISCAL_TEST_CONFIGURATION_SECRET_ARN }));
    if (!result.SecretString || Buffer.byteLength(result.SecretString) > 64 * 1024) throw new Error();
    const config = realTestConfigurationSchema.parse(JSON.parse(result.SecretString));
    if (config.orgId !== context.orgId || config.orgId !== process.env.FISCAL_TEST_ORG_ID ||
      config.operatorUserId !== context.userId || config.outletId !== request.outletId ||
      config.sessionId !== request.sessionId || config.invoiceId !== request.invoiceId) throw new Error();
    return { realConfiguration: config, classifications: config.classifications, mapping: config.mapping,
      adapter: new BeninEMecefTestAdapter(), credential: () => config.token };
  } catch { throw new AppError(403, "DOMAIN_PERMISSION_REQUIRED"); }
}, true);
export async function handler(event: APIGatewayProxyEventV2WithJWTAuthorizer) {
  const route = RESTAURANT_FISCAL_ROUTES.find(r => `${r.method} ${r.path}` === event.routeKey);
  if (!route) return { statusCode: 404, body: "{}" };
  if (route.operation === "adjudicate")
    return restaurantFiscalAdjudicationHandler()(event);
  if (!realFiscalTestEnabled()) return { statusCode: 403, body: JSON.stringify({ error: { code: "DOMAIN_PERMISSION_REQUIRED" } }) };
  return restaurantFiscalHandler(route.name, service, true)(event);
}
