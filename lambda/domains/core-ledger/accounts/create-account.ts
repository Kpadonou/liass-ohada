import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { PutItemCommand } from "@aws-sdk/client-dynamodb";
import { marshall } from "@aws-sdk/util-dynamodb";
import { AccountSchema, padAccountNumber } from "@/models/core-ledger/account";
import { KeyFactory } from "../../../shared/key-builder";
import { I18nResolver } from "../../../shared/i18n";
import { dynamoClient, config } from "../../../shared/dynamo-client";
import {
  badRequest,
  created,
  toLambdaResponse,
} from "@/models/shared/api-response";

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    const body = JSON.parse(event.body || "{}");
    const orgId = event.requestContext.authorizer?.claims?.orgId || "test-org";
    const { year, ...rest } = body; // explicitly drop year if provided by client

    const accountNumber = rest.accountNumber;
    const accountId = padAccountNumber(accountNumber);

    const accountData = {
      ...rest,
      orgId,
      accountId,
      entityType: "ACCOUNT",
      PK: KeyFactory.orgKey(orgId),
      SK: KeyFactory.accountSK(accountId),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const validation = AccountSchema.safeParse(accountData);
    if (!validation.success) {
      const i18n = new I18nResolver(event.headers["Accept-Language"]);
      return toLambdaResponse(
        badRequest(i18n.getMessage("ERROR_INVALID_INPUT"))
      );
    }

    // Put item with conditional expression to ensure we don't overwrite existing account
    await dynamoClient.send(
      new PutItemCommand({
        TableName: config.TABLE_NAME,
        Item: marshall(validation.data),
        ConditionExpression:
          "attribute_not_exists(#PK) AND attribute_not_exists(#SK)",
        ExpressionAttributeNames: { "#PK": "PK", "#SK": "SK" },
      })
    );

    const i18n = new I18nResolver(event.headers["Accept-Language"]);
    return toLambdaResponse(
      created(validation.data, i18n.getMessage("SUCCESS_ACCOUNT_CREATED"))
    );
  } catch (error) {
    console.error(error);
    const i18n = new I18nResolver(event.headers["Accept-Language"]);
    return toLambdaResponse(badRequest(i18n.getMessage("ERROR_INTERNAL")));
  }
};
