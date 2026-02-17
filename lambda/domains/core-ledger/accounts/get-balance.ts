import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { getAccountBalance } from "@/lambda/shared/services/balance-service";
import { I18nResolver } from "@/lambda/shared/i18n";
import { badRequest, ok, toLambdaResponse } from "@/models/shared/api-response";

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    // Extract parameters from path
    const orgId = event.pathParameters?.orgId;
    const fiscalYear = event.pathParameters?.fiscalYear;
    const accountId = event.pathParameters?.accountId;

    // Validate required parameters
    if (!orgId || !fiscalYear || !accountId) {
      const i18n = new I18nResolver(event.headers["Accept-Language"]);
      return toLambdaResponse(
        badRequest(i18n.getMessage("ERROR_INVALID_INPUT"))
      );
    }

    // Get account balance using the balance service
    const balance = await getAccountBalance(orgId, fiscalYear, accountId);

    const i18n = new I18nResolver(event.headers["Accept-Language"]);
    return toLambdaResponse(
      ok(balance, i18n.getMessage("SUCCESS_BALANCE_RETRIEVED"))
    );
  } catch (error) {
    console.error(error);
    const i18n = new I18nResolver(event.headers["Accept-Language"]);
    return toLambdaResponse(badRequest(i18n.getMessage("ERROR_INTERNAL")));
  }
};
