// lambda/shared/services/lettering-service.ts

import { config } from "@/lambda/shared/config";
import { dynamoClient } from "@/lambda/shared/dynamo-client";
import { KeyFactory } from "@/lambda/shared/key-builder";
import { QueryCommand } from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";

export class LetteringService {
  /**
   * Retrieves all lines for a specific third-party and groups them by lettering status.
   * This uses the GSI3 which acts as a Sparse Index.
   */
  static async getThirdPartyReport(
    orgId: string,
    accountId: string,
    thirdPartyId: string,
  ) {
    const queryResult = await dynamoClient.send(
      new QueryCommand({
        TableName: config.TABLE_NAME,
        IndexName: config.GSI3,
        KeyConditionExpression: "GSI3PK = :pk",
        ExpressionAttributeValues: marshall({
          ":pk": KeyFactory.letteringPK(orgId, accountId, thirdPartyId),
        }),
      }),
    );

    const items = (queryResult.Items || []).map((i) => unmarshall(i));

    const letteredGroups: Record<string, any[]> = {};
    const unletteredLines: any[] = [];
    let totalDebit = 0;
    let totalCredit = 0;

    items.forEach((line) => {
      const debit = Number(line.debit) || 0;
      const credit = Number(line.credit) || 0;
      totalDebit += debit;
      totalCredit += credit;

      if (line.letteringCode) {
        if (!letteredGroups[line.letteringCode]) {
          letteredGroups[line.letteringCode] = [];
        }
        letteredGroups[line.letteringCode].push(line);
      } else {
        unletteredLines.push(line);
      }
    });

    return {
      summary: {
        totalDebit,
        totalCredit,
        balance: totalDebit - totalCredit,
      },
      letteredGroups,
      unletteredLines,
    };
  }
}
