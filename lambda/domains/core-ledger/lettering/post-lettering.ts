import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { TransactWriteItemsCommand } from "@aws-sdk/client-dynamodb";
import { marshall } from "@aws-sdk/util-dynamodb";
import { dynamoClient } from "@/lambda/shared/dynamo-client";
import { config } from "@/lambda/shared/config";
import { KeyFactory } from "@/lambda/shared/key-builder";
import { I18nResolver } from "@/lambda/shared/i18n";
import { toLambdaResponse, ok, badRequest } from "@/models/shared/api-response";

/**
 * Confirms a lettering (matching) operation between multiple entry lines.
 * It calculates the balance to determine if the match is COMPLETE (Uppercase code)
 * or PARTIAL (Lowercase code).
 * Updates the technical L_SK index to move lines from 'UNLETTERED' to 'LETTERED'
 * status atomically using a DynamoDB transaction.
 */
export const handler = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  const i18n = new I18nResolver(event.headers["Accept-Language"]);

  try {
    const body = JSON.parse(event.body || "{}");
    const { orgId, year, lines, letteringCode } = body;

    // 1. Validation: Ensure we have enough data to perform a match
    if (
      !orgId ||
      !year ||
      !letteringCode ||
      !Array.isArray(lines) ||
      lines.length < 2
    ) {
      return toLambdaResponse(
        badRequest(i18n.getMessage("ERROR_LETTERING_INSUFFICIENT_DATA")),
      );
    }

    // 2. Accounting Logic: Calculate Balance to define status
    // In double-entry bookkeeping, a perfect match results in a zero balance.
    const balance = lines.reduce(
      (acc: number, l: any) =>
        acc + (Number(l.debit) || 0) - (Number(l.credit) || 0),
      0,
    );

    // SYSCOHADA convention: Uppercase for COMPLETE, Lowercase for PARTIAL
    const isComplete = Math.abs(balance) < 0.01; // Handling floating point precision
    const finalCode = isComplete
      ? letteringCode.toUpperCase()
      : letteringCode.toLowerCase();
    const letteringStatus = isComplete ? "COMPLETE" : "PARTIAL";

    // 3. Prepare Atomic Transaction to update all involved lines
    const now = new Date().toISOString();
    const transactItems = lines.map((l: any) => {
      // Reconstruct the Sort Key (L_SK) for the Lettering GSI
      const metadata = l.currentLSk
        ? l.currentLSk.replace("UNLETTERED#", "")
        : `${l.entryDate}#${l.entryId}`;
      const newLSk = `LETTERED#${finalCode}#${metadata}`;

      return {
        Update: {
          TableName: config.TABLE_NAME,
          Key: marshall({
            PK: KeyFactory.partitionKey(orgId, year),
            SK: KeyFactory.entryLineSK(l.lineId),
          }),
          // Security: Ensure the line exists and isn't already fully lettered
          ConditionExpression:
            "attribute_exists(L_PK) AND (attribute_not_exists(letteringStatus) OR letteringStatus = :partial)",
          UpdateExpression: `
            SET L_SK = :newLSk, 
                letteringCode = :code, 
                letteringStatus = :status, 
                updatedAt = :now
          `,
          ExpressionAttributeValues: marshall({
            ":partial": "PARTIAL",
            ":newLSk": newLSk,
            ":code": finalCode,
            ":status": letteringStatus,
            ":now": now,
          }),
        },
      };
    });

    await dynamoClient.send(
      new TransactWriteItemsCommand({ TransactItems: transactItems }),
    );

    return toLambdaResponse(
      ok(
        {
          letteringCode: finalCode,
          letteringStatus,
          remainingBalance: Math.abs(balance),
        },
        i18n.getMessage("SUCCESS_LETTERING_CONFIRMED"),
      ),
    );
  } catch (error: any) {
    console.error("ConfirmLettering Error:", error);

    // Specifically handle cases where the transaction fails due to condition checks
    if (error.name === "TransactionCanceledException") {
      return toLambdaResponse(
        badRequest(i18n.getMessage("ERROR_ALREADY_LETTERED_OR_MISSING")),
      );
    }
    return toLambdaResponse(badRequest(i18n.getMessage("ERROR_INTERNAL")));
  }
};
