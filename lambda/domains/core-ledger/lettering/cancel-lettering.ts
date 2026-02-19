import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import {
  TransactWriteItemsCommand,
  BatchGetItemCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { dynamoClient } from "@/lambda/shared/dynamo-client";
import { config } from "@/lambda/shared/config";
import { KeyFactory } from "@/lambda/shared/key-builder";
import { I18nResolver } from "@/lambda/shared/i18n";
import { EntryLineSchema } from "@/models/core-ledger/entry";
import { toLambdaResponse, ok, badRequest } from "@/models/shared/api-response";

/**
 * Reverts a lettering operation using KeyFactory for index reconstruction.
 * It resets entry lines to an UNLETTERED state in GSI3 and clears lettering attributes.
 * Data is fetched from DB to ensure the L_SK is restored using official metadata.
 * * @param event - APIGatewayProxyEvent containing orgId, year, and lineKeys (PK/SK).
 * @returns APIGatewayProxyResult
 */
export const handler = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  const i18n = new I18nResolver(event.headers["Accept-Language"]);

  try {
    const body = JSON.parse(event.body || "{}");
    const { orgId, year, lineKeys } = body;

    // 1. Validation: Use KeyFactory logic or presence of IDs
    if (
      !orgId ||
      !year ||
      !lineKeys ||
      !Array.isArray(lineKeys) ||
      lineKeys.length === 0
    ) {
      return toLambdaResponse(
        badRequest(i18n.getMessage("ERROR_MISSING_PARAMETERS")),
      );
    }

    // 2. Fetch lines from DynamoDB (Source of Truth)
    const batchResult = await dynamoClient.send(
      new BatchGetItemCommand({
        RequestItems: {
          [config.TABLE_NAME]: {
            Keys: lineKeys.map((key: any) =>
              marshall({ PK: key.PK, SK: key.SK }),
            ),
          },
        },
      }),
    );

    const lines = (batchResult.Responses?.[config.TABLE_NAME] || []).map(
      (item) => EntryLineSchema.parse(unmarshall(item)),
    );

    if (lines.length === 0) {
      return toLambdaResponse(
        badRequest(i18n.getMessage("ERROR_LINES_NOT_FOUND")),
      );
    }

    // 3. Prepare Atomic Transaction
    const now = new Date().toISOString();
    const transactItems = lines.map((line) => {
      /**
       * Restore the original UNLETTERED L_SK using KeyFactory.letteringSK.
       * We use the data from the record (entryDate, entryId, and lineId/index)
       * to ensure the GSI3 is perfectly restored to its pre-match state.
       */
      const restoredLSk = KeyFactory.letteringSK(
        line.entryDate,
        line.entryId,
        line.lineId, // Assuming lineId is the unique index within the entry
      );

      return {
        Update: {
          TableName: config.TABLE_NAME,
          Key: marshall({ PK: line.PK, SK: line.SK }),
          // Safety: Prevent un-lettering something that isn't lettered
          ConditionExpression: "attribute_exists(letteringCode)",
          UpdateExpression: `
            SET L_SK = :restoredLSk, 
                updatedAt = :now 
            REMOVE letteringCode, letteringStatus, letteringId
          `,
          ExpressionAttributeValues: marshall({
            ":restoredLSk": restoredLSk,
            ":now": now,
          }),
        },
      };
    });

    // 4. Execute transaction
    await dynamoClient.send(
      new TransactWriteItemsCommand({
        TransactItems: transactItems,
      }),
    );

    return toLambdaResponse(
      ok(
        {
          linesProcessed: lines.length,
        },
        i18n.getMessage("SUCCESS_UNLETTERING_COMPLETED"),
      ),
    );
  } catch (error: any) {
    console.error("CancelLettering Error:", error);

    if (error.name === "TransactionCanceledException") {
      return toLambdaResponse(
        badRequest(i18n.getMessage("ERROR_UNLETTERING_CONDITION_FAILED")),
      );
    }

    return toLambdaResponse(badRequest(i18n.getMessage("ERROR_INTERNAL")));
  }
};
