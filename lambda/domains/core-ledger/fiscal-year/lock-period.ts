/**
 * @async
 * @function handler
 * @description Manages the locking/unlocking of a monthly accounting period.
 * * This handler creates or updates a 'PERIOD_LOCK' item in DynamoDB.
 * Once a period is 'LOCKED', all write operations (post-entry, lettering)
 * targeting this month must be rejected by the system.
 * * @param {APIGatewayProxyEvent} event - AWS Lambda event containing:
 * - body.year: The fiscal year (e.g., 2026).
 * - body.month: The month number (1-12).
 * - body.status: 'LOCKED' | 'OPEN'.
 * * @returns {Promise<APIGatewayProxyResult>} 200 on success, 400 on technical error.
 */
import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { PutItemCommand } from "@aws-sdk/client-dynamodb";
import { marshall } from "@aws-sdk/util-dynamodb";
import { dynamoClient } from "@/lambda/shared/dynamo-client";
import { config } from "@/lambda/shared/config";
import { KeyFactory } from "@/lambda/shared/key-builder";
import { I18nResolver } from "@/lambda/shared/i18n";
import { ok, badRequest, toLambdaResponse } from "@/models/shared/api-response";

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
