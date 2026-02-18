import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import {
  getAccountEntries,
  AccountEntriesOptions,
} from "@/lambda/shared/services/ledger-service";
import { I18nResolver } from "@/lambda/shared/i18n";
import { badRequest, ok, toLambdaResponse } from "@/models/shared/api-response";

/**
 * Retrieves a paginated list of accounting entries for a specific account.
 * This function allows users to drill down into the details of an account's balance
 * for a given fiscal year. It supports pagination via 'limit' and 'cursor' parameters.
 */
export const handler = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  const i18n = new I18nResolver(event.headers["Accept-Language"]);

  try {
    const orgId = event.requestContext.authorizer?.claims?.orgId || "test-org";
    // Extract parameters from path
    const fiscalYear = event.pathParameters?.fiscalYear;
    const accountId = event.pathParameters?.accountId;

    // Extract query parameters for pagination
    const limit = event.queryStringParameters?.limit
      ? parseInt(event.queryStringParameters.limit, 10)
      : undefined;
    const cursor = event.queryStringParameters?.cursor;

    // Validate required path parameters
    if (!orgId || !fiscalYear || !accountId) {
      return toLambdaResponse(
        badRequest(i18n.getMessage("ERROR_INVALID_INPUT")),
      );
    }

    // Validate limit parameter if provided (ensure it's within a reasonable range)
    if (limit !== undefined && (isNaN(limit) || limit <= 0 || limit > 1000)) {
      return toLambdaResponse(
        badRequest(i18n.getMessage("ERROR_INVALID_INPUT")),
      );
    }

    // Prepare options for the service
    const options: AccountEntriesOptions = {};
    if (limit) options.limit = limit;
    if (cursor) options.cursor = cursor;

    // Get account entries using the shared ledger service
    // The service handles the complex GSI queries and pagination logic
    const result = await getAccountEntries(
      orgId,
      fiscalYear,
      accountId,
      options,
    );

    return toLambdaResponse(
      ok(result, i18n.getMessage("SUCCESS_ENTRIES_RETRIEVED")),
    );
  } catch (error: any) {
    console.error("GetEntries Error:", error);
    return toLambdaResponse(badRequest(i18n.getMessage("ERROR_INTERNAL")));
  }
};
