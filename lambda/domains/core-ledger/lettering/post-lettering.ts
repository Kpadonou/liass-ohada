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

/**
 * Confirms a lettering (matching) operation between multiple entry lines.
 * For SYCEBNL organizations, it enforces that all lines belong to the same project
 * to ensure funding justification integrity.
 * * @param event - APIGatewayProxyEvent containing lineKeys and letteringCode.
 * @returns APIGatewayProxyResult with the final lettering status.
 */
export const handler = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  const i18n = new I18nResolver(event.headers["Accept-Language"]);

  try {
    const body = JSON.parse(event.body || "{}");
    const { orgId, year, lineKeys, letteringCode } = body;

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

    // 2. Fetch Organization to check Accounting Standard
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

    // 3. Fetch official data from DB (Source of Truth Security)
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

    // 4. Consistency & SYCEBNL Validation
    const firstLine = lines[0];
    const accountId = firstLine.accountId;
    const thirdPartyId = firstLine.thirdPartyId;
    const projectId = firstLine.projectId;

    for (const line of lines) {
      // Basic accounting consistency
      if (line.accountId !== accountId || line.thirdPartyId !== thirdPartyId) {
        return toLambdaResponse(
          badRequest(
            i18n.getMessage("ERROR_INCONSISTENT_ACCOUNT_OR_THIRD_PARTY"),
          ),
        );
      }

      // SYCEBNL Strict project consistency
      if (isSYCEBNL && line.projectId !== projectId) {
        return toLambdaResponse(
          badRequest(i18n.getMessage("ERROR_INCONSISTENT_PROJECTS")),
        );
      }
    }

    // 5. Accounting Logic: Calculate Balance
    const balance = lines.reduce((acc, l) => acc + (l.debit - l.credit), 0);
    const isComplete = Math.abs(balance) < 0.01;
    const finalCode = isComplete
      ? letteringCode.toUpperCase()
      : letteringCode.toLowerCase();
    const letteringStatus = isComplete ? "COMPLETE" : "PARTIAL";

    // 6. Execute Atomic Transaction
    const now = new Date().toISOString();
    const transactItems = lines.map((line) => {
      // Reconstruct the Sort Key (L_SK) for GSI3
      const metadata =
        line.L_SK?.split("#").slice(1).join("#") ||
        `${line.entryDate}#${line.lineId}`;
      const newLSk = `LETTERED#${finalCode}#${metadata}`;

      return {
        Update: {
          TableName: config.TABLE_NAME,
          Key: marshall({ PK: line.PK, SK: line.SK }),
          ConditionExpression:
            "attribute_exists(L_PK) AND (letteringStatus <> :complete)",
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
          remainingBalance: Math.abs(balance),
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
