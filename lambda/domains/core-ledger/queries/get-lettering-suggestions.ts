import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { QueryCommand } from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import { dynamoClient } from "../../../shared/dynamo-client";
import { config } from "../../../shared/config";
import { KeyFactory } from "../../../shared/key-builder";
import {
  toLambdaResponse,
  ok,
  badRequest,
} from "../../../../models/shared/api-response";

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    const { orgId, accountId, thirdPartyId } =
      event.queryStringParameters || {};

    if (!orgId || !accountId || !thirdPartyId) {
      return toLambdaResponse(
        badRequest("Missing parameters: orgId, accountId, or thirdPartyId")
      );
    }

    // 1. Query the Sparse Index (GSI3) - Extremely fast!
    const params = {
      TableName: config.TABLE_NAME,
      IndexName: "GSI3",
      KeyConditionExpression: "L_PK = :lpk",
      ExpressionAttributeValues: {
        ":lpk": { S: KeyFactory.unletteredPK(orgId, accountId, thirdPartyId) },
      },
    };

    const { Items } = await dynamoClient.send(new QueryCommand(params));
    const unletteredLines = (Items || []).map((item) => unmarshall(item));

    if (unletteredLines.length === 0) {
      return toLambdaResponse(ok({ suggestions: [] }, "No lines to match."));
    }

    // 2. Simple Matching Algorithm (Perfect Match)
    const debits = unletteredLines.filter((l) => (l.debit || 0) > 0);
    const credits = unletteredLines.filter((l) => (l.credit || 0) > 0);

    const suggestions: any[] = [];
    const matchedIds = new Set<string>();

    for (const d of debits) {
      // Find a credit with same amount that hasn't been matched yet
      const match = credits.find(
        (c) => c.credit === d.debit && !matchedIds.has(c.lineId)
      );

      if (match) {
        matchedIds.add(d.lineId);
        matchedIds.add(match.lineId);

        suggestions.push({
          type: "PERFECT_MATCH",
          amount: d.debit,
          lines: [
            {
              lineId: d.lineId,
              date: d.entryDate,
              label: d.label || "Invoice",
            },
            {
              lineId: match.lineId,
              date: match.entryDate,
              label: match.label || "Payment",
            },
          ],
        });
      }
    }

    // 3. Tu pourrais ajouter ici une logique FIFO ou de somme combinée...

    return toLambdaResponse(
      ok({
        totalUnlettered: unletteredLines.length,
        suggestionsFound: suggestions.length,
        suggestions,
      })
    );
  } catch (error) {
    console.error("Suggestion Error:", error);
    return toLambdaResponse(badRequest("Error generating suggestions."));
  }
};
