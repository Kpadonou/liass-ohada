import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { TransactWriteItemsCommand } from "@aws-sdk/client-dynamodb";
import { marshall } from "@aws-sdk/util-dynamodb";
import { dynamoClient } from "@/lambda/shared/dynamo-client";
import { config } from "@/lambda/shared/config";
import { KeyFactory } from "@/lambda/shared/key-builder";
import { I18nResolver } from "@/lambda/shared/i18n";
import { toLambdaResponse, ok, badRequest } from "@/models/shared/api-response";

/**
 * Reverts a lettering operation by resetting involved entry lines to an UNLETTERED state.
 * This restores the technical L_SK index to its original metadata-based format,
 * making the lines available again for future matching suggestions.
 * It uses a DynamoDB transaction to ensure all lines are un-lettered simultaneously.
 */
export const handler = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  const i18n = new I18nResolver(event.headers["Accept-Language"]);

  try {
    const body = JSON.parse(event.body || "{}");
    const { orgId, year, lines } = body;

    // 1. Validation: Ensure all necessary data for the reversal is present
    if (!orgId || !year || !Array.isArray(lines) || lines.length === 0) {
      return toLambdaResponse(
        badRequest(i18n.getMessage("ERROR_MISSING_PARAMETERS")),
      );
    }

    const now = new Date().toISOString();

    // 2. Prepare Atomic Transaction
    const transactItems = lines.map((l: any) => {
      // Logic: Restore L_SK by stripping the 'LETTERED#{code}#' prefix
      // Format transformation: 'LETTERED#ABC#2026-02-09#ENT-123' -> 'UNLETTERED#2026-02-09#ENT-123'
      const parts = l.currentLSk.split("#");

      // parts[0] = 'LETTERED', parts[1] = code, parts[2..n] = original metadata (date, id)
      const metadata = parts.slice(2).join("#");
      const restoredLSk = `UNLETTERED#${metadata}`;

      return {
        Update: {
          TableName: config.TABLE_NAME,
          Key: marshall({
            PK: KeyFactory.partitionKey(orgId, year),
            SK: KeyFactory.entryLineSK(l.lineId),
          }),
          // Security: Only revert if the line is currently in a lettered state
          ConditionExpression:
            "attribute_exists(L_PK) AND begins_with(L_SK, :letteredPrefix)",
          UpdateExpression: `
            SET L_SK = :restoredLSk, 
                updatedAt = :now 
            REMOVE letteringCode, letteringStatus, letteringId
          `,
          ExpressionAttributeValues: marshall({
            ":letteredPrefix": "LETTERED#",
            ":restoredLSk": restoredLSk,
            ":now": now,
          }),
        },
      };
    });

    // 3. Execute the transaction to maintain ledger integrity
    await dynamoClient.send(
      new TransactWriteItemsCommand({
        TransactItems: transactItems,
      }),
    );

    return toLambdaResponse(
      ok(
        {
          message: "Un-lettering successful",
          linesProcessed: lines.length,
        },
        i18n.getMessage("SUCCESS_UNLETTERING_COMPLETED"),
      ),
    );
  } catch (error: any) {
    console.error("UnLettering Error:", error);

    // Handle cases where the lines might have already been modified
    if (error.name === "TransactionCanceledException") {
      return toLambdaResponse(
        badRequest(i18n.getMessage("ERROR_UNLETTERING_CONDITION_FAILED")),
      );
    }

    return toLambdaResponse(
      badRequest(i18n.getMessage("ERROR_UNLETTERING_FAILED")),
    );
  }
};
