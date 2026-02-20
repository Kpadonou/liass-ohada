/**
 * @async
 * @function handler
 * @description Finalizes a lettering (matching) operation between multiple entry lines.
 * For SYCEBNL organizations, it enforces that all lines belong to the same project.
 * It moves lines from the 'UNLETTERED' state to 'LETTERED' in the GSI_LETTERING index.
 * * @param {APIGatewayProxyEvent} event - AWS Lambda event containing:
 * - body.orgId: Organization ID.
 * - body.year: Fiscal year.
 * - body.lineKeys: Array of {PK, SK} of the lines to match.
 * - body.letteringCode: The character(s) used for matching (e.g., 'A', 'BC').
 * * @returns {Promise<APIGatewayProxyResult>}
 * - 200: Lettering success with final status (COMPLETE or PARTIAL).
 * - 400: Inconsistent projects, different accounts, or balance issues.
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import {
  TransactWriteItemsCommand,
  BatchGetItemCommand,
  GetItemCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { dynamoClient } from "@/lambda/shared/dynamo-client";
import { config } from "@/lambda/shared/config";
import { KeyFactory } from "@/lambda/shared/key-builder";
import { I18nResolver } from "@/lambda/shared/i18n";
import { EntryLineSchema } from "@/models/core-ledger/entry";
import { toLambdaResponse, ok, badRequest } from "@/models/shared/api-response";
import { LockService } from "@/lambda/shared/services/lock-service";

export const handler = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  const i18n = new I18nResolver(event.headers["Accept-Language"]);

  try {
    const body = JSON.parse(event.body || "{}");
    const { orgId: inputOrgId, year, lineKeys, letteringCode } = body;
    const orgId = event.requestContext?.authorizer?.claims?.orgId || inputOrgId;

    // 1. Basic Validation
    if (
      !orgId ||
      !year ||
      !letteringCode ||
      !Array.isArray(lineKeys) ||
      lineKeys.length < 2
    ) {
      return toLambdaResponse(
        badRequest(i18n.getMessage("ERROR_LETTERING_INSUFFICIENT_DATA")),
      );
    }

    // 2. Fetch Organization to check Accounting Standard (SYCEBNL vs General)
    const orgResult = await dynamoClient.send(
      new GetItemCommand({
        TableName: config.TABLE_NAME,
        Key: marshall({
          PK: KeyFactory.orgKey(orgId),
          SK: KeyFactory.orgKey(orgId),
        }),
      }),
    );
    const organization = unmarshall(orgResult.Item || {});
    const isSYCEBNL = organization.accountingStandard === "SYCEBNL";

    // 3. Fetch source items to validate state and consistency
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

    if (lines.length !== lineKeys.length) {
      return toLambdaResponse(
        badRequest(i18n.getMessage("ERROR_SOME_LINES_NOT_FOUND")),
      );
    }

    // On vérifie si la période de l'écriture originale est verrouillée
    if (await LockService.isPeriodLocked(orgId, lines[0].entryDate)) {
      return toLambdaResponse(
        badRequest(i18n.getMessage("ERROR_PERIOD_LOCKED")),
      );
    }

    // 4. SYCEBNL & Accounting Consistency Checks
    const firstLine = lines[0];
    const accountId = firstLine.accountId;
    const thirdPartyId = firstLine.thirdPartyId;
    const projectId = firstLine.projectId;

    for (const line of lines) {
      // Must be same account and same third party
      if (line.accountId !== accountId || line.thirdPartyId !== thirdPartyId) {
        return toLambdaResponse(
          badRequest(
            i18n.getMessage("ERROR_INCONSISTENT_ACCOUNT_OR_THIRD_PARTY"),
          ),
        );
      }

      // SYCEBNL: Must be same project and projectId must exist
      if (isSYCEBNL) {
        if (!line.projectId || line.projectId !== projectId) {
          return toLambdaResponse(
            badRequest(i18n.getMessage("ERROR_INCONSISTENT_PROJECTS")),
          );
        }
      }
    }

    // 5. Balance Calculation (Using Integers)
    const totalBalance = lines.reduce(
      (acc, l) => acc + (l.debit - l.credit),
      0,
    );
    const isComplete = totalBalance === 0;

    // Formatting: Uppercase for COMPLETE, lowercase for PARTIAL
    const finalCode = isComplete
      ? letteringCode.toUpperCase()
      : letteringCode.toLowerCase();
    const letteringStatus = isComplete ? "COMPLETE" : "PARTIAL";

    // 6. Transactional Update
    const now = new Date().toISOString();
    const transactItems = lines.map((line) => {
      // Transition L_SK from UNLETTERED#... to LETTERED#...
      // We keep the original metadata (date#entryId#lineId) for audit
      const originalMetadata =
        line.L_SK?.replace(/^UNLETTERED#/, "") ||
        `${line.entryDate}#${line.entryId}#${line.lineId}`;
      const newLSk = `LETTERED#${finalCode}#${originalMetadata}`;

      return {
        Update: {
          TableName: config.TABLE_NAME,
          Key: marshall({ PK: line.PK, SK: line.SK }),
          // Safety: Only update if not already fully lettered
          ConditionExpression:
            "attribute_exists(L_PK) AND letteringStatus <> :complete",
          UpdateExpression: `
            SET L_SK = :newLSk, 
                letteringCode = :code, 
                letteringStatus = :status, 
                updatedAt = :now
          `,
          ExpressionAttributeValues: marshall({
            ":complete": "COMPLETE",
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
          remainingBalance: Math.abs(totalBalance),
        },
        i18n.getMessage("SUCCESS_LETTERING_CONFIRMED"),
      ),
    );
  } catch (error: any) {
    console.error("ConfirmLettering Error:", error);
    if (error.name === "TransactionCanceledException") {
      return toLambdaResponse(
        badRequest(i18n.getMessage("ERROR_ALREADY_LETTERED_OR_MISSING")),
      );
    }
    return toLambdaResponse(badRequest(i18n.getMessage("ERROR_INTERNAL")));
  }
};
