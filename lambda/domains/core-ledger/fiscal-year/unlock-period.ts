import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { marshall } from "@aws-sdk/util-dynamodb";
import { dynamoClient } from "@/lambda/shared/dynamo-client";
import { config } from "@/lambda/shared/config";
import { KeyFactory } from "@/lambda/shared/key-builder";
import { I18nResolver } from "@/lambda/shared/i18n";
import { ok, badRequest, toLambdaResponse } from "@/models/shared/api-response";

/**
 * Unlocks a specific period by setting its status back to 'OPEN'.
 * This allows users to post new entries or modify existing ones for that month.
 */
export const handler = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  const i18n = new I18nResolver(event.headers["Accept-Language"]);
  try {
    const body = JSON.parse(event.body || "{}");
    const { year, month } = body;
    const orgId = event.requestContext?.authorizer?.claims?.orgId;

    if (!year || !month) {
      return toLambdaResponse(
        badRequest(i18n.getMessage("ERROR_MISSING_PARAMETERS")),
      );
    }

    // On passe le statut à OPEN au lieu de supprimer l'item pour garder une trace
    await dynamoClient.send(
      new UpdateItemCommand({
        TableName: config.TABLE_NAME,
        Key: marshall({
          PK: KeyFactory.partitionKey(orgId, year),
          SK: KeyFactory.periodLockSK(month),
        }),
        UpdateExpression: "SET #s = :status, updatedAt = :now",
        ExpressionAttributeNames: { "#s": "status" },
        ExpressionAttributeValues: marshall({
          ":status": "OPEN",
          ":now": new Date().toISOString(),
        }),
      }),
    );

    return toLambdaResponse(ok({}, i18n.getMessage("SUCCESS_PERIOD_UNLOCKED")));
  } catch (error: any) {
    console.error("UnlockPeriod Error:", error);
    return toLambdaResponse(
      badRequest(i18n.getMessage("ERROR_PERIOD_LOCK_TECHNICAL")),
    );
  }
};
