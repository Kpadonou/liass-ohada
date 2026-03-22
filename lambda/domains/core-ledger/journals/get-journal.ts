import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { GetItemCommand } from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import { KeyFactory } from "@/lambda/shared/key-builder";
import { I18nResolver } from "@/lambda/shared/i18n";
import { dynamoClient } from "@/lambda/shared/dynamo-client";
import { config } from "@/lambda/shared/config";
import {
  ok,
  notFound,
  toLambdaResponse,
} from "@/models/shared/api-response";

/**
 * Retrieves a specific journal by journalCode.
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
        notFound(i18n.getMessage("ERROR_INVALID_INPUT")),
      );
    }

    const result = await dynamoClient.send(
      new GetItemCommand({
        TableName: config.TABLE_NAME,
        Key: {
          PK: { S: KeyFactory.orgKey(orgId) },
          SK: { S: `JNL#${journalCode}` },
        },
      }),
    );

    if (!result.Item) {
      return toLambdaResponse(
        notFound(i18n.getMessage("JOURNAL_NOT_FOUND")),
      );
    }

    const journal = unmarshall(result.Item);

    return toLambdaResponse(
      ok(journal, i18n.getMessage("JOURNAL_RETRIEVED")),
    );
  } catch (error) {
    console.error("Error getting journal:", error);
    return toLambdaResponse(
      notFound(i18n.getMessage("ERROR_INTERNAL")),
    );
  }
};