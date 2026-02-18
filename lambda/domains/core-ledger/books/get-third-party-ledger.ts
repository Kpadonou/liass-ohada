import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { QueryCommand } from "@aws-sdk/client-dynamodb";
import { unmarshall, marshall } from "@aws-sdk/util-dynamodb";
import { dynamoClient } from "@/lambda/shared/dynamo-client";
import { config } from "@/lambda/shared/config";
import { KeyFactory } from "@/lambda/shared/key-builder";
import { I18nResolver } from "@/lambda/shared/i18n";
import { toLambdaResponse, ok, badRequest } from "@/models/shared/api-response";

/**
 * Retrieves a chronological transaction history (Subsidiary Ledger) for a specific third party.
 * This report is essential for generating customer/vendor statements and reconciling
 * outstanding balances. It leverages GSI2 (Third Party Index) for efficient date-range filtering.
 */
export const handler = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  const i18n = new I18nResolver(event.headers["Accept-Language"]);

  try {
    const { orgId, accountId, thirdPartyId, startDate, endDate } =
      event.queryStringParameters || {};

    if (!orgId || !accountId || !thirdPartyId) {
      return toLambdaResponse(
        badRequest(i18n.getMessage("ERROR_MISSING_PARAMETERS")),
      );
    }

    // 1. Prepare Query on GSI2 (Third Party Index)
    // The PK is built using KeyFactory to target the specific third-party sub-ledger
    let keyCondition = "GSI2PK = :pk";
    const expressionAttributeValues: any = {
      ":pk": KeyFactory.gsi2PK(orgId, accountId, thirdPartyId),
    };

    // Optional: Filter by Date Range using the Sort Key (GSI2SK: DT#{date}#{lineId})
    if (startDate && endDate) {
      keyCondition += " AND GSI2SK BETWEEN :start AND :end";
      expressionAttributeValues[":start"] = `DT#${startDate}`;
      expressionAttributeValues[":end"] = `DT#${endDate}#z`; // '#z' ensures the entire end date is included
    }

    const params = {
      TableName: config.TABLE_NAME,
      IndexName: config.GSI_THIRD_PARTY,
      KeyConditionExpression: keyCondition,
      ExpressionAttributeValues: marshall(expressionAttributeValues),
      ScanIndexForward: true, // Maintain chronological order for running balance suitability
    };

    const { Items } = await dynamoClient.send(new QueryCommand(params));
    const lines = (Items || []).map((item) => unmarshall(item));

    // 2. Data Aggregation: Calculate totals for the report header
    const totals = lines.reduce(
      (acc, line) => {
        acc.debit += Number(line.debit) || 0;
        acc.credit += Number(line.credit) || 0;
        return acc;
      },
      { debit: 0, credit: 0 },
    );

    return toLambdaResponse(
      ok(
        {
          thirdPartyId,
          accountId,
          period: { startDate, endDate },
          summary: {
            totalDebit: totals.debit,
            totalCredit: totals.credit,
            balance: totals.debit - totals.credit,
          },
          count: lines.length,
          lines,
        },
        i18n.getMessage("SUCCESS_THIRD_PARTY_LEDGER_RETRIEVED"),
      ),
    );
  } catch (error) {
    console.error("GetThirdPartyLedger Error:", error);
    return toLambdaResponse(
      badRequest(i18n.getMessage("ERROR_THIRD_PARTY_LEDGER_TECHNICAL")),
    );
  }
};
