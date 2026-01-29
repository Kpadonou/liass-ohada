import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { DynamoDBClient, PutItemCommand } from "@aws-sdk/client-dynamodb";
import { marshall } from "@aws-sdk/util-dynamodb";
import { AccountSchema, padAccountNumber } from "@/models/core-ledger/account";
import { KeyFactory } from "../../../shared/key-builder";
import { I18nResolver } from "../../../shared/i18n";
import {
  badRequest,
  created,
  toLambdaResponse,
} from "@/models/shared/api-response";

const dynamoClient = new DynamoDBClient({});

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    const body = JSON.parse(event.body || "{}");
    const orgId = event.requestContext.authorizer?.claims?.orgId || "test-org"; // TODO: from JWT
    const year = parseInt(body.year);
    const accountNumber = body.accountNumber;

    const accountId = padAccountNumber(accountNumber);

    const accountData = {
      ...body,
      orgId,
      year,
      accountId,
      entityType: "ACCOUNT",
      pk: KeyFactory.partitionKey(orgId, year),
      sk: KeyFactory.accountSK(accountId),
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

    // TODO: Check FiscalYear status

    await dynamoClient.send(
      new PutItemCommand({
        TableName: process.env.TABLE_NAME!,
        Item: marshall(validation.data),
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
