/**
 * @async
 * @function handler
 * @description Reverts a lettering (matching) operation for a set of accounting lines.
 * * Orchestrates the following:
 * 1. Fetches the current state of the lines from DynamoDB.
 * 2. Validates that the lines are actually lettered.
 * 3. Reconstructs the original 'UNLETTERED' Sort Key (GSI3SK) using KeyFactory.
 * 4. Atomically removes lettering metadata (code, status) and restores the GSI index state.
 * * @param {APIGatewayProxyEvent} event - AWS Lambda event containing:
 * - body.lineKeys: Array of {PK, SK} of the lines to un-match.
 * * @returns {Promise<APIGatewayProxyResult>}
 * - 200: Un-lettering successful, lines are back to 'UNLETTERED' status.
 * - 400: Lines not found, not lettered, or internal error.
 */
import { config } from "@/lambda/shared/config";
import { dynamoClient } from "@/lambda/shared/dynamo-client";
import { I18nResolver } from "@/lambda/shared/i18n";
import { KeyFactory } from "@/lambda/shared/key-builder";
import { LockPeriodService } from "@/lambda/shared/services/lock-period-service";
import { EntryLineSchema } from "@/models/core-ledger/entry";
import {
  badRequest,
  ok,
  toLambdaResponse,
  unauthorized,
} from "@/models/shared/api-response";
import {
  BatchGetItemCommand,
  TransactWriteItemsCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";

export const handler = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  const i18n = new I18nResolver(event.headers["Accept-Language"]);

  try {
    const body = JSON.parse(event.body || "{}");
    const { lineKeys } = body;
    const orgId = event.requestContext?.authorizer?.claims?.orgId;

    if (!orgId) {
      return toLambdaResponse(unauthorized());
    }

    // 1. Validation de base
    if (
      !lineKeys ||
      !Array.isArray(lineKeys) ||
      lineKeys.length === 0
    ) {
      return toLambdaResponse(
        badRequest(i18n.getMessage("ERROR_MISSING_PARAMETERS")),
      );
    }

    // 2. Récupération des données sources (Source of Truth)
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

    // Sécurité : On vérifie la date de la ligne qu'on tente de dé-lettrer
    if (await LockPeriodService.isPeriodLocked(orgId, lines[0].entryDate)) {
      return toLambdaResponse(
        badRequest(i18n.getMessage("ERROR_PERIOD_LOCKED")),
      );
    }

    // 3. Préparation de la transaction atomique
    const now = new Date().toISOString();
    const transactItems = lines.map((line) => {
      /**
       * On reconstruit le GSI3SK original (UNLETTERED#...) via la KeyFactory.
       * Cela garantit que la ligne réapparaîtra immédiatement dans les suggestions.
       */
      const restoredLSk = KeyFactory.letteringSK(
        line.entryDate,
        line.entryId,
        line.lineId,
      );

      return {
        Update: {
          TableName: config.TABLE_NAME,
          Key: marshall({ PK: line.PK, SK: line.SK }),
          // Sécurité : On ne peut dé-lettrer que si un code de lettrage existe
          ConditionExpression: "attribute_exists(letteringCode)",
          UpdateExpression: `
            SET GSI3SK = :restoredLSk, 
                updatedAt = :now 
            REMOVE letteringCode, letteringStatus
          `,
          ExpressionAttributeValues: marshall({
            ":restoredLSk": restoredLSk,
            ":now": now,
          }),
        },
      };
    });

    // 4. Exécution de la transaction
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
