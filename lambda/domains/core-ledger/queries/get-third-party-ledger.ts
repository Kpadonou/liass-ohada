import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { QueryCommand } from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import { dynamoClient } from "../../../shared/dynamo-client";
import { config } from "../../../shared/config";
import { KeyFactory } from "../../../shared/key-builder";
import { I18nResolver } from "../../../shared/i18n";
import {
  toLambdaResponse,
  ok,
  badRequest,
} from "../../../../models/shared/api-response";

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  const i18n = new I18nResolver(event.headers["Accept-Language"]);

  try {
    const { orgId, accountId, thirdPartyId, startDate, endDate } =
      event.queryStringParameters || {};

    if (!orgId || !accountId || !thirdPartyId) {
      return toLambdaResponse(
        badRequest(i18n.getMessage("ERROR_MISSING_PARAMETERS"))
      );
    }

    // 1. Prepare Query on GSI2 (Third Party Index)
    // PK: ORG#{orgId}#ACC#{accountId}#TP#{thirdPartyId}
    // SK: DT#{date}#{lineId} (Allows date range filtering)

    let keyCondition = "GSI2PK = :pk";
    const expressionAttributeValues: any = {
      ":pk": { S: KeyFactory.gsiThirdPartyPK(orgId, accountId, thirdPartyId) },
    };

    // Optional: Filter by Date Range using the Sort Key (GSI2SK)
    if (startDate && endDate) {
      keyCondition += " AND GSI2SK BETWEEN :start AND :end";
      expressionAttributeValues[":start"] = { S: `DT#${startDate}` };
      expressionAttributeValues[":end"] = { S: `DT#${endDate}#z` }; // #z to include everything on that day
    }

    const params = {
      TableName: config.TABLE_NAME,
      IndexName: "GSI2", // Third Party Auxiliary Index
      KeyConditionExpression: keyCondition,
      ExpressionAttributeValues: expressionAttributeValues,
      ScanIndexForward: true, // true = Chronological, false = Newest first
    };

    const { Items } = await dynamoClient.send(new QueryCommand(params));
    const lines = (Items || []).map((item) => unmarshall(item));

    // 2. Calculate totals for the ledger header
    const totals = lines.reduce(
      (acc, line) => {
        acc.debit += Number(line.debit) || 0;
        acc.credit += Number(line.credit) || 0;
        return acc;
      },
      { debit: 0, credit: 0 }
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
        i18n.getMessage("SUCCESS_THIRD_PARTY_LEDGER_RETRIEVED")
      )
    );
  } catch (error) {
    console.error("GetThirdPartyLedger Error:", error);
    return toLambdaResponse(
      badRequest(i18n.getMessage("ERROR_THIRD_PARTY_LEDGER_TECHNICAL"))
    );
  }
};
