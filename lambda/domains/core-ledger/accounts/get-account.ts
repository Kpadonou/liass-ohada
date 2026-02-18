import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { GetItemCommand } from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import { KeyFactory } from "@/lambda/shared/key-builder";
import { I18nResolver } from "@/lambda/shared/i18n";
import { dynamoClient } from "@/lambda/shared/dynamo-client";
import { config } from "@/lambda/shared/config";
import { badRequest, ok, toLambdaResponse } from "@/models/shared/api-response";

/**
 * Retrieves the details of a specific accounting account.
 * It uses the organization ID and the padded account ID to fetch the record.
 * This is used to verify account settings, labels, or its status within the chart of accounts.
 */
export const handler = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  const i18n = new I18nResolver(event.headers["Accept-Language"]);

  try {
    const orgId = event.requestContext.authorizer?.claims?.orgId || "test-org";
    const accountId = event.pathParameters?.accountId || "";

    if (!accountId) {
      return toLambdaResponse(
        badRequest(i18n.getMessage("ERROR_MISSING_PARAMETERS")),
      );
    }

    // Use orgKey to target the account within the organization's global chart of accounts
    const result = await dynamoClient.send(
      new GetItemCommand({
        TableName: config.TABLE_NAME,
        Key: {
          PK: { S: KeyFactory.orgKey(orgId) },
          SK: { S: KeyFactory.accountSK(accountId) },
        },
      }),
    );

    if (!result.Item) {
      return toLambdaResponse(
        badRequest(i18n.getMessage("ERROR_ACCOUNT_NOT_FOUND")),
      );
    }

    const account = unmarshall(result.Item);

    return toLambdaResponse(
      ok(account, i18n.getMessage("SUCCESS_ACCOUNT_RETRIEVED")),
    );
  } catch (error) {
    console.error("GetAccount Error:", error);
    return toLambdaResponse(badRequest(i18n.getMessage("ERROR_INTERNAL")));
  }
};
