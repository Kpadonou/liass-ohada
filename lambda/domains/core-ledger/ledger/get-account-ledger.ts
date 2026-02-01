import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { QueryCommand } from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import { I18nResolver } from "../../../shared/i18n";
import { ok, toLambdaResponse, badRequest } from "../../../../models/shared/api-response";
import { dynamoClient } from "../../../shared/dynamo-client";
import { config } from "../../../shared/config";

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  const i18n = new I18nResolver(event.headers["Accept-Language"]);

  try {
    const orgId = event.requestContext.authorizer?.claims?.orgId || "test-org";
    const fiscalYear = event.queryStringParameters?.fiscalYear || "2024";
    const accountId = event.queryStringParameters?.accountId || "";

    if (!accountId) {
      return toLambdaResponse(
        badRequest(i18n.getMessage("ERROR_INVALID_INPUT"))
      );
    }

    // Pad account number to 8 digits
    const paddedAccountId = accountId.padStart(8, "0");

    // Query the GSI-Account to get all entries for this account in the fiscal year
    const queryResult = await dynamoClient.send(
      new QueryCommand({
        TableName: config.TABLE_NAME,
        IndexName: "GSI-Account",
        KeyConditionExpression: "PK = :pk AND begins_with(GSI1SK, :gsi1sk)",
        ExpressionAttributeValues: {
          ":pk": { S: `ORG#${orgId}#FY#${fiscalYear}` },
          ":gsi1sk": { S: `ACC#${paddedAccountId}` },
        },
        ScanIndexForward: true, // Sort by date ascending (date is in GSI1SK)
      })
    );

    const ledgerEntries: any[] = [];
    let runningBalance = 0;

    // Process the results and calculate running balance
    if (queryResult.Items) {
      for (const item of queryResult.Items) {
        const unmarshalled = unmarshall(item);

        // Calculate running balance (debit increases, credit decreases for asset accounts)
        // This is a simplified calculation - in reality, you'd need to know the account type
        const debit = unmarshalled.debit || 0;
        const credit = unmarshalled.credit || 0;
        runningBalance += debit - credit;

        ledgerEntries.push({
          date: unmarshalled.entryDate,
          label: unmarshalled.description || "",
          reference: unmarshalled.voucherNumber || "",
          debit: debit,
          credit: credit,
          runningBalance: runningBalance,
        });
      }
    }

    return toLambdaResponse(
      ok(ledgerEntries, i18n.getMessage("SUCCESS_LEDGER_RETRIEVED"))
    );
  } catch (error) {
    console.error("GetAccountLedger Error:", error);
    return toLambdaResponse(badRequest(i18n.getMessage("ERROR_INTERNAL")));
  }
};