import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { getAccountBalance } from "@/lambda/shared/services/balance-service";
import { I18nResolver } from "@/lambda/shared/i18n";
import { badRequest, ok, toLambdaResponse } from "@/models/shared/api-response";

/**
 * Retrieves the current balance for a specific account within a fiscal year.
 * It aggregates all posted transactions for the given organization and account.
 * This function relies on the shared balance-service to perform the calculation logic.
 */
export const handler = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  const i18n = new I18nResolver(event.headers["Accept-Language"]);

  try {
    const orgId = event.requestContext.authorizer?.claims?.orgId || "test-org";
    const fiscalYear = event.pathParameters?.fiscalYear;
    const accountId = event.pathParameters?.accountId;

    // Validate required parameters
    if (!orgId || !fiscalYear || !accountId) {
      return toLambdaResponse(
        badRequest(i18n.getMessage("ERROR_INVALID_INPUT")),
      );
    }

    // Get account balance using the balance service
    // This service handles the DynamoDB query and the debit/credit summation
    const balance = await getAccountBalance(orgId, fiscalYear, accountId);

    return toLambdaResponse(
      ok(balance, i18n.getMessage("SUCCESS_BALANCE_RETRIEVED")),
    );
  } catch (error: any) {
    console.error("GetBalance Error:", error);
    return toLambdaResponse(badRequest(i18n.getMessage("ERROR_INTERNAL")));
  }
};
