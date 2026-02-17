import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { QueryCommand } from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import { dynamoClient } from "@/lambda/shared/dynamo-client";
import { config } from "@/lambda/shared/config";
import { KeyFactory } from "@/lambda/shared/key-builder";
import { I18nResolver } from "@/lambda/shared/i18n";
import { toLambdaResponse, ok, badRequest } from "@/models/shared/api-response";

/**
 * Retrieves the auxiliary ledger for a specific third party, grouped by lettering status.
 * This is primarily used for credit management and matching invoices with payments.
 * It uses the GSI_LETTERING index to organize data into lettered groups and unlettered lines.
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

    // --- NORMALISATION VIA KEYFACTORY ---
    const letteringPk = KeyFactory.letteringPK(orgId, accountId, thirdPartyId);

    const command = new QueryCommand({
      TableName: config.TABLE_NAME,
      IndexName: config.GSI_LETTERING,
      KeyConditionExpression: "L_PK = :lpk",
      ExpressionAttributeValues: {
        ":lpk": { S: letteringPk },
      },
    });

    const { Items = [] } = await dynamoClient.send(command);
    const lines = Items.map((item) => unmarshall(item));

    const report = {
      summary: { totalDebit: 0, totalCredit: 0, balance: 0 },
      letteredGroups: {} as Record<string, any[]>,
      unletteredLines: [] as any[],
    };

    lines.forEach((line) => {
      const debit = Number(line.debit) || 0;
      const credit = Number(line.credit) || 0;
      report.summary.totalDebit += debit;
      report.summary.totalCredit += credit;

      if (line.letteringCode) {
        if (!report.letteredGroups[line.letteringCode])
          report.letteredGroups[line.letteringCode] = [];
        report.letteredGroups[line.letteringCode].push(line);
      } else {
        report.unletteredLines.push(line);
      }
    });

    report.summary.balance =
      report.summary.totalDebit - report.summary.totalCredit;

    return toLambdaResponse(
      ok(report, i18n.getMessage("SUCCESS_AUXILIARY_LEDGER_RETRIEVED")),
    );
  } catch (error: any) {
    console.error("AuxiliaryLedger Error:", error);
    return toLambdaResponse(
      badRequest(i18n.getMessage("ERROR_AUXILIARY_LEDGER_TECHNICAL")),
    );
  }
};
