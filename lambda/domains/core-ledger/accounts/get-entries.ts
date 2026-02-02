import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import {
  getAccountEntries,
  AccountEntriesOptions,
} from "../../../shared/services/ledger-service";
import { I18nResolver } from "../../../shared/i18n";
import { badRequest, ok, toLambdaResponse } from "@/models/shared/api-response";

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    // Extract parameters from path
    const orgId = event.pathParameters?.orgId;
    const fiscalYear = event.pathParameters?.fiscalYear;
    const accountId = event.pathParameters?.accountId;

    // Extract query parameters
    const limit = event.queryStringParameters?.limit
      ? parseInt(event.queryStringParameters.limit, 10)
      : undefined;
    const cursor = event.queryStringParameters?.cursor;

    // Validate required path parameters
    if (!orgId || !fiscalYear || !accountId) {
      const i18n = new I18nResolver(event.headers["Accept-Language"]);
      return toLambdaResponse(
        badRequest(i18n.getMessage("ERROR_INVALID_INPUT"))
      );
    }

    // Validate limit parameter if provided
    if (limit !== undefined && (isNaN(limit) || limit <= 0 || limit > 1000)) {
      const i18n = new I18nResolver(event.headers["Accept-Language"]);
      return toLambdaResponse(
        badRequest(i18n.getMessage("ERROR_INVALID_INPUT"))
      );
    }

    // Prepare options for the service
    const options: AccountEntriesOptions = {};
    if (limit) options.limit = limit;
    if (cursor) options.cursor = cursor;

    // Get account entries using the ledger service
    const result = await getAccountEntries(
      orgId,
      fiscalYear,
      accountId,
      options
    );

    const i18n = new I18nResolver(event.headers["Accept-Language"]);
    return toLambdaResponse(
      ok(result, i18n.getMessage("SUCCESS_ENTRIES_RETRIEVED"))
    );
  } catch (error) {
    console.error(error);
    const i18n = new I18nResolver(event.headers["Accept-Language"]);
    return toLambdaResponse(badRequest(i18n.getMessage("ERROR_INTERNAL")));
  }
};
