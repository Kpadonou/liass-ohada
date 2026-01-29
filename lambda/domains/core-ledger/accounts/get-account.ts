import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { DynamoDBClient, GetItemCommand } from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import { KeyFactory } from "../../../shared/key-builder";
import { I18nResolver } from "../../../shared/i18n";
import { badRequest, ok, toLambdaResponse } from "@/models/shared/api-response";

const dynamoClient = new DynamoDBClient({});

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    const orgId = event.requestContext.authorizer?.claims?.orgId || "test-org";
    const year = parseInt(event.pathParameters?.year || "2024");
    const accountId = event.pathParameters?.accountId || "";

    const pk = KeyFactory.partitionKey(orgId, year);
    const sk = KeyFactory.accountSK(accountId);

    const result = await dynamoClient.send(
      new GetItemCommand({
        TableName: process.env.TABLE_NAME!,
        Key: { pk: { S: pk }, sk: { S: sk } },
      })
    );

    if (!result.Item) {
      const i18n = new I18nResolver(event.headers["Accept-Language"]);
      return toLambdaResponse(
        badRequest(i18n.getMessage("ERROR_ACCOUNT_NOT_FOUND"))
      );
    }

    const account = unmarshall(result.Item);

    const i18n = new I18nResolver(event.headers["Accept-Language"]);
    return toLambdaResponse(
      ok(account, i18n.getMessage("SUCCESS_ACCOUNT_RETRIEVED"))
    );
  } catch (error) {
    console.error(error);
    const i18n = new I18nResolver(event.headers["Accept-Language"]);
    return toLambdaResponse(badRequest(i18n.getMessage("ERROR_INTERNAL")));
  }
};
