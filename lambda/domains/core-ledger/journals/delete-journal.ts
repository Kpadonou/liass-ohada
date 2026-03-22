import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { DeleteItemCommand } from "@aws-sdk/client-dynamodb";
import { KeyFactory } from "@/lambda/shared/key-builder";
import { I18nResolver } from "@/lambda/shared/i18n";
import { dynamoClient } from "@/lambda/shared/dynamo-client";
import { config } from "@/lambda/shared/config";
import { badRequest, ok, toLambdaResponse } from "@/models/shared/api-response";

/**
 * Deletes a journal by journalCode.
 */
export const handler = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  const i18n = new I18nResolver(event.headers["Accept-Language"]);

  try {
    const orgId = event.requestContext.authorizer?.claims?.orgId || "test-org";
    const journalCode = event.pathParameters?.journalCode;

    if (!journalCode) {
      return toLambdaResponse(
        badRequest(i18n.getMessage("ERROR_INVALID_INPUT")),
      );
    }

    await dynamoClient.send(
      new DeleteItemCommand({
        TableName: config.TABLE_NAME,
        Key: {
          PK: { S: KeyFactory.orgKey(orgId) },
          SK: { S: `JNL#${journalCode}` },
        },
      }),
    );

    return toLambdaResponse(ok({}, i18n.getMessage("JOURNAL_DELETED")));
  } catch (error) {
    console.error("Error deleting journal:", error);
    return toLambdaResponse(badRequest(i18n.getMessage("ERROR_INTERNAL")));
  }
};
