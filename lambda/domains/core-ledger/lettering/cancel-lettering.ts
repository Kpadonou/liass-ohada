import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { TransactWriteItemsCommand } from "@aws-sdk/client-dynamodb";
import { marshall } from "@aws-sdk/util-dynamodb";
import { dynamoClient } from "@/lambda/shared/dynamo-client";
import { config } from "@/lambda/shared/config";
import { KeyFactory } from "@/lambda/shared/key-builder";
import { I18nResolver } from "@/lambda/shared/i18n";
import { toLambdaResponse, ok, badRequest } from "@/models/shared/api-response";

/**
 * Un-lettering Handler:
 * Reverts lines to UNLETTERED state, making them visible again in suggestions.
 */
export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  const i18n = new I18nResolver(event.headers["Accept-Language"]);

  try {
    const body = JSON.parse(event.body || "{}");
    const { orgId, year, lines } = body;

    if (!orgId || !year || !Array.isArray(lines) || lines.length === 0) {
      return toLambdaResponse(
        badRequest(i18n.getMessage("ERROR_MISSING_PARAMETERS"))
      );
    }

    const now = new Date().toISOString();
    const transactItems = lines.map((l: any) => {
      // Logic: Restore L_SK by removing 'LETTERED#{code}#' prefix
      // Example: 'LETTERED#ABC#2026-02-09#ENT-123' -> 'UNLETTERED#2026-02-09#ENT-123'
      const parts = l.currentLSk.split("#");
      // parts[0] is 'LETTERED', parts[1] is the code, the rest is metadata
      const metadata = parts.slice(2).join("#");
      const restoredLSk = `UNLETTERED#${metadata}`;

      return {
        Update: {
          TableName: config.TABLE_NAME,
          Key: marshall({
            PK: KeyFactory.partitionKey(orgId, year),
            SK: KeyFactory.entryLineSK(l.lineId),
          }),
          // Security: Only un-letter if it's actually lettered
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

    await dynamoClient.send(
      new TransactWriteItemsCommand({
        TransactItems: transactItems,
      })
    );

    return toLambdaResponse(
      ok(
        {
          message: "Un-lettering successful",
          linesProcessed: lines.length,
        },
        i18n.getMessage("SUCCESS_UNLETTERING_COMPLETED")
      )
    );
  } catch (error: any) {
    console.error("UnLettering Error:", error);
    return toLambdaResponse(
      badRequest(i18n.getMessage("ERROR_UNLETTERING_FAILED"))
    );
  }
};
