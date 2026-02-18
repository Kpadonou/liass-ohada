import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { PutItemCommand } from "@aws-sdk/client-dynamodb";
import { marshall } from "@aws-sdk/util-dynamodb";
import { dynamoClient } from "@/lambda/shared/dynamo-client";
import { config } from "@/lambda/shared/config";
import { KeyFactory } from "@/lambda/shared/key-builder";
import { I18nResolver } from "@/lambda/shared/i18n";
import { ok, badRequest, toLambdaResponse } from "@/models/shared/api-response";

/**
 * Manages the locking state of a specific monthly period.
 * Locking a period is a preventive measure to ensure that transactions
 * for a closed month are no longer modified or added during an audit or
 * after tax filings.
 */
export const handler = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  const i18n = new I18nResolver(event.headers["Accept-Language"]);
  try {
    const body = JSON.parse(event.body || "{}");
    const { year, month, status } = body; // Expected status: 'LOCKED' | 'OPEN'
    const orgId = event.requestContext?.authorizer?.claims?.orgId;

    if (!year || !month || !status) {
      return toLambdaResponse(
        badRequest(i18n.getMessage("ERROR_MISSING_PARAMETERS")),
      );
    }

    // Prepare the lock item using the centralized KeyFactory
    const lockItem = {
      PK: KeyFactory.partitionKey(orgId, year),
      SK: KeyFactory.periodLockSK(month),
      orgId,
      year,
      month: month.toString().padStart(2, "0"), // Normalized padding for queries
      status,
      entityType: "PERIOD_LOCK",
      updatedAt: new Date().toISOString(),
    };

    await dynamoClient.send(
      new PutItemCommand({
        TableName: config.TABLE_NAME,
        Item: marshall(lockItem),
      }),
    );

    const successKey =
      status === "LOCKED" ? "SUCCESS_PERIOD_LOCKED" : "SUCCESS_PERIOD_UNLOCKED";

    return toLambdaResponse(ok(lockItem, i18n.getMessage(successKey)));
  } catch (error: any) {
    console.error("LockPeriod Error:", error);
    return toLambdaResponse(
      badRequest(i18n.getMessage("ERROR_PERIOD_LOCK_TECHNICAL")),
    );
  }
};
