import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { QueryCommand } from "@aws-sdk/client-dynamodb";
import { unmarshall, marshall } from "@aws-sdk/util-dynamodb";
import { dynamoClient } from "@/lambda/shared/dynamo-client";
import { config } from "@/lambda/shared/config";
import { KeyFactory } from "@/lambda/shared/key-builder";
import { I18nResolver } from "@/lambda/shared/i18n";
import { toLambdaResponse, ok, badRequest } from "@/models/shared/api-response";

/**
 * Generates a matching (lettering) status report for a specific third party.
 * It provides a structured view of:
 * 1. Lettered Groups: Transactions already matched and balanced.
 * 2. Unlettered Lines: Outstanding items (unpaid invoices or unapplied payments).
 * This is the primary tool for accounts receivable/payable reconciliation.
 */
export const handler = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  const i18n = new I18nResolver(event.headers["Accept-Language"]);

  try {
    const { orgId, accountId, thirdPartyId } =
      event.queryStringParameters || {};

    if (!orgId || !accountId || !thirdPartyId) {
      return toLambdaResponse(
        badRequest(i18n.getMessage("ERROR_MISSING_PARAMETERS")),
      );
    }

    // Target the specific lettering partition using KeyFactory
    const letteringPk = KeyFactory.letteringPK(orgId, accountId, thirdPartyId);

    const command = new QueryCommand({
      TableName: config.TABLE_NAME,
      IndexName: config.GSI_LETTERING,
      KeyConditionExpression: "L_PK = :lpk",
      ExpressionAttributeValues: marshall({
        ":lpk": letteringPk,
      }),
    });

    const { Items = [] } = await dynamoClient.send(command);
    const lines = Items.map((item) => unmarshall(item));

    const report = {
      summary: {
        totalDebit: 0,
        totalCredit: 0,
        balance: 0,
      },
      letteredGroups: {} as Record<string, any[]>,
      unletteredLines: [] as any[],
    };

    lines.forEach((line) => {
      const debit = Number(line.debit) || 0;
      const credit = Number(line.credit) || 0;

      report.summary.totalDebit += debit;
      report.summary.totalCredit += credit;

      // Grouping logic based on the presence of a letteringCode
      if (line.letteringCode) {
        if (!report.letteredGroups[line.letteringCode]) {
          report.letteredGroups[line.letteringCode] = [];
        }
        report.letteredGroups[line.letteringCode].push(line);
      } else {
        report.unletteredLines.push(line);
      }
    });

    // Net balance of the third party account
    report.summary.balance =
      report.summary.totalDebit - report.summary.totalCredit;

    return toLambdaResponse(
      ok(report, i18n.getMessage("SUCCESS_MATCHING_REPORT_RETRIEVED")),
    );
  } catch (error: any) {
    console.error("MatchingReport Error:", error);
    return toLambdaResponse(
      badRequest(i18n.getMessage("ERROR_MATCHING_REPORT_TECHNICAL")),
    );
  }
};
