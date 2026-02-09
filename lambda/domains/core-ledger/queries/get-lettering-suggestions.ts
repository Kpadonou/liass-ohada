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
  const i18n = new I18nResolver(event.headers?.["Accept-Language"]);

  try {
    const { orgId, accountId, thirdPartyId } =
      event.queryStringParameters || {};

    if (!orgId || !accountId || !thirdPartyId) {
      return toLambdaResponse(
        badRequest(i18n.getMessage("ERROR_MISSING_PARAMETERS"))
      );
    }

    // 1. Query the Sparse Index (GSI3) - Fetch only what is not fully lettered
    const params = {
      TableName: config.TABLE_NAME,
      IndexName: config.GSI_LETTERING, // Ensure this name matches your AWS configuration
      KeyConditionExpression: "L_PK = :lpk",
      ExpressionAttributeValues: {
        ":lpk": { S: KeyFactory.unletteredPK(orgId, accountId, thirdPartyId) },
      },
    };

    const { Items } = await dynamoClient.send(new QueryCommand(params));
    const unletteredLines = (Items || []).map((item) => unmarshall(item));

    if (unletteredLines.length === 0) {
      return toLambdaResponse(
        ok({ suggestions: [] }, i18n.getMessage("INFO_NO_LINES_TO_MATCH"))
      );
    }

    // 2. Data Preparation
    const debits = unletteredLines.filter((l) => (Number(l.debit) || 0) > 0);
    const credits = unletteredLines.filter((l) => (Number(l.credit) || 0) > 0);
    const suggestions: any[] = [];
    const matchedIds = new Set<string>();

    // --- STRATEGY 1: PERFECT MATCH (Exact amounts) ---
    for (const d of debits) {
      const match = credits.find(
        (c) => Number(c.credit) === Number(d.debit) && !matchedIds.has(c.lineId)
      );

      if (match) {
        matchedIds.add(d.lineId);
        matchedIds.add(match.lineId);

        suggestions.push({
          type: "PERFECT_MATCH",
          amount: Number(d.debit),
          lines: [
            {
              lineId: d.lineId,
              date: d.entryDate,
              label: d.label || "Invoice",
              type: "DEBIT",
            },
            {
              lineId: match.lineId,
              date: match.entryDate,
              label: match.label || "Payment",
              type: "CREDIT",
            },
          ],
        });
      }
    }

    // --- STRATEGY 2: FIFO (First-In, First-Out for remaining lines) ---
    const remainingDebits = debits
      .filter((d) => !matchedIds.has(d.lineId))
      .sort((a, b) => a.entryDate.localeCompare(b.entryDate));

    const remainingCredits = credits
      .filter((c) => !matchedIds.has(c.lineId))
      .sort((a, b) => a.entryDate.localeCompare(b.entryDate));

    let dIdx = 0;
    let cIdx = 0;

    // Track partial amounts
    const tempDebits: any[] = remainingDebits.map((d) => ({
      ...d,
      rem: Number(d.debit),
    }));
    const tempCredits: any[] = remainingCredits.map((c) => ({
      ...c,
      rem: Number(c.credit),
    }));

    while (dIdx < tempDebits.length && cIdx < tempCredits.length) {
      const d = tempDebits[dIdx];
      const c = tempCredits[cIdx];
      const matchAmount = Math.min(d.rem, c.rem);

      if (matchAmount > 0) {
        suggestions.push({
          type: "FIFO_SUGGESTION",
          amount: matchAmount,
          lines: [
            {
              lineId: d.lineId,
              date: d.entryDate,
              role: "DEBT",
              amount: d.debit,
            },
            {
              lineId: c.lineId,
              date: c.entryDate,
              role: "PAYMENT",
              amount: c.credit,
            },
          ],
        });
      }

      d.rem -= matchAmount;
      c.rem -= matchAmount;

      if (d.rem <= 0) dIdx++;
      if (c.rem <= 0) cIdx++;
    }

    return toLambdaResponse(
      ok(
        {
          totalUnlettered: unletteredLines.length,
          suggestionsFound: suggestions.length,
          suggestions,
        },
        i18n.getMessage("SUCCESS_SUGGESTIONS_RETRIEVED")
      )
    );
  } catch (error) {
    console.error("Suggestion Error:", error);
    return toLambdaResponse(
      badRequest(i18n.getMessage("ERROR_SUGGESTIONS_TECHNICAL"))
    );
  }
};
