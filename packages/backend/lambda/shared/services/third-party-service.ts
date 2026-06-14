import { config } from "@/lambda/shared/config";
import { dynamoClient } from "@/lambda/shared/dynamo-client";
import { KeyFactory } from "@/lambda/shared/key-builder";
import { QueryCommand } from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";

/**
 * @description Enhanced Subsidiary Ledger with Lettering support.
 * Fetches the Subsidiary Ledger (history) for a specific third-party account.
 */
export class ThirdPartyService {
  static async getLedger(
    orgId: string,
    params: {
      accountId: string;
      thirdPartyId: string;
      startDate?: string;
      endDate?: string;
    },
  ) {
    const { accountId, thirdPartyId, startDate, endDate } = params;
    const normalizedAccountId = accountId.padEnd(8, "0");

    let keyCondition = "GSI2PK = :pk";
    const expressionValues: any = {
      ":pk": KeyFactory.gsi2PK(orgId, normalizedAccountId, thirdPartyId),
    };

    if (startDate && endDate) {
      keyCondition += " AND GSI2SK BETWEEN :start AND :end";
      expressionValues[":start"] = `DT#${startDate}`;
      expressionValues[":end"] = `DT#${endDate}#z`;
    }

    const result = await dynamoClient.send(
      new QueryCommand({
        TableName: config.TABLE_NAME,
        IndexName: config.GSI2,
        KeyConditionExpression: keyCondition,
        ExpressionAttributeValues: marshall(expressionValues),
        ScanIndexForward: true, // Chronological order
      }),
    );

    const lines = (result.Items || []).map((item) => {
      const line = unmarshall(item);
      return {
        date: line.entryDate,
        label: line.label,
        reference: line.voucherNumber,
        debit: Number(line.debit) || 0,
        credit: Number(line.credit) || 0,
        // The famous lettering code for reconciliation
        letteringCode: line.letteringCode || null,
        entryId: line.entryId,
        lineId: line.lineId,
      };
    });

    const summary = lines.reduce(
      (acc, line) => {
        acc.totalDebit += line.debit;
        acc.totalCredit += line.credit;
        return acc;
      },
      { totalDebit: 0, totalCredit: 0 },
    );

    return {
      accountId: normalizedAccountId,
      thirdPartyId,
      period: { startDate, endDate },
      summary: {
        ...summary,
        balance: summary.totalDebit - summary.totalCredit,
      },
      count: lines.length,
      lines,
    };
  }
}
