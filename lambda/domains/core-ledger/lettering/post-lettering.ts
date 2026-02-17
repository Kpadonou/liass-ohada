import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { TransactWriteItemsCommand } from "@aws-sdk/client-dynamodb";
import { marshall } from "@aws-sdk/util-dynamodb";
import { dynamoClient } from "@/lambda/shared/dynamo-client";
import { config } from "@/lambda/shared/config";
import { KeyFactory } from "@/lambda/shared/key-builder";
import { I18nResolver } from "@/lambda/shared/i18n";
import { toLambdaResponse, ok, badRequest } from "@/models/shared/api-response";

/**
 * Merged Lettering Handler:
 * 1. Validates accounting balance (Partial vs Complete)
 * 2. Updates business status (letteringCode, status)
 * 3. Updates technical index (L_SK) to remove from suggestions
 */
export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  const i18n = new I18nResolver(event.headers["Accept-Language"]);

  try {
    const body = JSON.parse(event.body || "{}");
    const { orgId, year, lines, letteringCode } = body;

    // 1. Basic Validation
    if (
      !orgId ||
      !year ||
      !letteringCode ||
      !Array.isArray(lines) ||
      lines.length < 2
    ) {
      return toLambdaResponse(
        badRequest(i18n.getMessage("ERROR_LETTERING_INSUFFICIENT_DATA"))
      );
    }

    // 2. Accounting Logic: Calculate Balance
    // In accounting, sum of debits - sum of credits should be 0 for a complete match
    const balance = lines.reduce(
      (acc: number, l: any) =>
        acc + (Number(l.debit) || 0) - (Number(l.credit) || 0),
      0
    );

    // Rule: If balance is 0 => COMPLETE (UPPERCASE), else => PARTIAL (lowercase)
    const isComplete = Math.abs(balance) < 0.01; // Avoid floating point issues
    const finalCode = isComplete
      ? letteringCode.toUpperCase()
      : letteringCode.toLowerCase();
    const letteringStatus = isComplete ? "COMPLETE" : "PARTIAL";

    // 3. Prepare Atomic Transaction
    const now = new Date().toISOString();
    const transactItems = lines.map((l: any) => {
      // Preserve metadata for the new L_SK while moving from UNLETTERED to LETTERED
      // currentLSk should be passed by the frontend or fetched
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
          // Security: Ensure line is still unlettered before matching
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
      new TransactWriteItemsCommand({ TransactItems: transactItems })
    );

    return toLambdaResponse(
      ok(
        {
          letteringCode: finalCode,
          letteringStatus,
          remainingBalance: Math.abs(balance),
        },
        i18n.getMessage("SUCCESS_LETTERING_CONFIRMED")
      )
    );
  } catch (error: any) {
    console.error("ConfirmLettering Error:", error);
    if (error.name === "TransactionCanceledException") {
      return toLambdaResponse(
        badRequest(i18n.getMessage("ERROR_ALREADY_LETTERED_OR_MISSING"))
      );
    }
    return toLambdaResponse(badRequest(i18n.getMessage("ERROR_INTERNAL")));
  }
};
