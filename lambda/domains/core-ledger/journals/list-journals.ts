import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { QueryCommand } from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import { KeyFactory } from "@/lambda/shared/key-builder";
import { I18nResolver } from "@/lambda/shared/i18n";
import { dynamoClient } from "@/lambda/shared/dynamo-client";
import { config } from "@/lambda/shared/config";
import {
  badRequest,
  ok,
  toLambdaResponse,
  unauthorized,
} from "@/models/shared/api-response";

/**
 * Lists all journals for the organization.
 */
export const handler = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  const i18n = new I18nResolver(event.headers["Accept-Language"]);

  try {
    const orgId = event.requestContext.authorizer?.claims?.orgId;
    if (!orgId) {
      return toLambdaResponse(unauthorized());
    }

    const result = await dynamoClient.send(
      new QueryCommand({
        TableName: config.TABLE_NAME,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
        ExpressionAttributeValues: {
          ":pk": { S: KeyFactory.orgKey(orgId) },
          ":sk": { S: "JNL#" },
        },
      }),
    );

    const journals = result.Items?.map((item) => unmarshall(item)) || [];

    return toLambdaResponse(
      ok(journals, i18n.getMessage("JOURNALS_RETRIEVED")),
    );
  } catch (error) {
    console.error("Error listing journals:", error);
    return toLambdaResponse(badRequest(i18n.getMessage("ERROR_INTERNAL")));
  }
};
