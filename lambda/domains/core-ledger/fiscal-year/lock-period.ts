import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { PutItemCommand } from "@aws-sdk/client-dynamodb";
import { marshall } from "@aws-sdk/util-dynamodb";
import { dynamoClient } from "../../../shared/dynamo-client";
import { config } from "../../../shared/config";
import { KeyFactory } from "../../../shared/key-builder";
import { I18nResolver } from "../../../shared/i18n";
import {
  ok,
  badRequest,
  toLambdaResponse,
} from "../../../../models/shared/api-response";

/**
 * Locks or unlocks a specific period within a fiscal year.
 * Used to prevent modifications to periods that have been closed or are under review.
 */
export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  const i18n = new I18nResolver(event.headers["Accept-Language"]);
  try {
    const body = JSON.parse(event.body || "{}");
    const { year, month, status } = body; // status: 'LOCKED' | 'OPEN'
    const orgId = event.requestContext?.authorizer?.claims?.orgId;

    if (!year || !month || !status) {
      return toLambdaResponse(
        badRequest(i18n.getMessage("ERROR_MISSING_PARAMETERS"))
      );
    }

    const lockItem = {
      PK: KeyFactory.partitionKey(orgId, year),
      SK: `LOCK#PERIOD#${month.toString().padStart(2, "0")}`,
      orgId,
      year,
      month,
      status,
      entityType: "PERIOD_LOCK",
      updatedAt: new Date().toISOString(),
    };

    await dynamoClient.send(
      new PutItemCommand({
        TableName: config.TABLE_NAME,
        Item: marshall(lockItem),
      })
    );

    const successKey =
      status === "LOCKED" ? "SUCCESS_PERIOD_LOCKED" : "SUCCESS_PERIOD_UNLOCKED";

    return toLambdaResponse(ok(lockItem, i18n.getMessage(successKey)));
  } catch (error: any) {
    console.error("LockPeriod Error:", error);
    return toLambdaResponse(
      badRequest(i18n.getMessage("ERROR_PERIOD_LOCK_TECHNICAL"))
    );
  }
};
