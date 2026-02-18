import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { PutItemCommand } from "@aws-sdk/client-dynamodb";
import { marshall } from "@aws-sdk/util-dynamodb";
import { AccountSchema, padAccountId } from "@/models/core-ledger/account";
import { KeyFactory } from "@/lambda/shared/key-builder";
import { I18nResolver } from "@/lambda/shared/i18n";
import { dynamoClient } from "@/lambda/shared/dynamo-client";
import { config } from "@/lambda/shared/config";
import {
  badRequest,
  created,
  toLambdaResponse,
} from "@/models/shared/api-response";

/**
 * Creates a new accounting account within the organization's chart of accounts.
 * It ensures the account ID is properly padded (e.g., "411" becomes "411000")
 * and prevents overwriting if the account already exists using a ConditionExpression.
 * Accounts are partitioned by organization to ensure data isolation.
 */
export const handler = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  const i18n = new I18nResolver(event.headers["Accept-Language"]);

  try {
    const body = JSON.parse(event.body || "{}");
    const orgId = event.requestContext.authorizer?.claims?.orgId || "test-org";
    const { year, ...rest } = body; // explicitly drop year if provided by client

    const accountIdInput = rest.accountId;
    const accountId = padAccountId(accountIdInput);

    // Préparation de l'objet métier avec les clés DynamoDB
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

    // Validation via Zod pour garantir l'intégrité des données OHADA
    const validation = AccountSchema.safeParse(accountData);
    if (!validation.success) {
      return toLambdaResponse(
        badRequest(i18n.getMessage("ERROR_INVALID_INPUT")),
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
      }),
    );

    return toLambdaResponse(
      created(validation.data, i18n.getMessage("SUCCESS_ACCOUNT_CREATED")),
    );
  } catch (error: any) {
    console.error("CreateAccount Error:", error);

    // Gestion spécifique de l'erreur de condition (compte déjà existant)
    if (error?.name === "ConditionalCheckFailedException") {
      return toLambdaResponse(
        badRequest(i18n.getMessage("ERROR_ACCOUNT_ALREADY_EXISTS")),
      );
    }
    return toLambdaResponse(badRequest(i18n.getMessage("ERROR_INTERNAL")));
  }
};
