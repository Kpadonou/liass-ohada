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

/**
 * Suggests matches between unlettered debits and credits for a specific third party.
 * Uses a Sparse GSI (L_PK/L_SK) for high performance.
 */
export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  // Localization setup (Fallback to code for now)
  const i18n = new I18nResolver(event.headers["Accept-Language"] || "en");

  try {
    const orgId =
      event.requestContext?.authorizer?.claims?.orgId ||
      event.queryStringParameters?.orgId;
    const { accountId, thirdPartyId } = event.queryStringParameters || {};

    if (!orgId || !accountId || !thirdPartyId) {
      return toLambdaResponse(
        badRequest(i18n.getMessage("ERROR_MISSING_PARAMETERS"))
      );
    }

    // 1. Query the Lettering Sparse Index
    // We filter by L_PK (Third Party) and L_SK starting with "UNLETTERED#"
    const params = {
      TableName: config.TABLE_NAME,
      IndexName: "GSI_LETTERING",
      KeyConditionExpression: "L_PK = :lpk AND begins_with(L_SK, :lsk)",
      ExpressionAttributeValues: {
        ":lpk": { S: KeyFactory.letteringPK(orgId, accountId, thirdPartyId) },
        ":lsk": { S: "UNLETTERED#" },
      },
    };

    const { Items } = await dynamoClient.send(new QueryCommand(params));
    const unletteredLines = (Items || []).map((item) => unmarshall(item));

    if (unletteredLines.length === 0) {
      return toLambdaResponse(
        ok(
          {
            totalUnlettered: 0,
            suggestions: [],
          },
          i18n.getMessage("INFO_NO_LINES_TO_MATCH")
        )
      );
    }

    // 2. Data Preparation: Split into Debits and Credits
    const debits = unletteredLines.filter((l) => (Number(l.debit) || 0) > 0);
    const credits = unletteredLines.filter((l) => (Number(l.credit) || 0) > 0);

    const suggestions: any[] = [];
    const matchedIds = new Set<string>();

    // --- STRATEGY 1: PERFECT MATCH (Exact amounts) ---
    // We prioritize matching invoices with their exact payments
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
              entryId: d.entryId,
              date: d.entryDate,
              label: d.label || "Invoice",
              amount: d.debit,
              type: "DEBIT",
            },
            {
              lineId: match.lineId,
              entryId: match.entryId,
              date: match.entryDate,
              label: match.label || "Payment",
              amount: match.credit,
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

    // Define a local type to avoid the "Property does not exist" error
    // Using 'any' here as requested to bypass strict mapping issues,
    // but ensuring the spread preserves original properties.
    const tempDebits: any[] = remainingDebits.map((d) => ({
      ...d,
      remainingAmount: Number(d.debit),
    }));

    const tempCredits: any[] = remainingCredits.map((c) => ({
      ...c,
      remainingAmount: Number(c.credit),
    }));

    while (dIdx < tempDebits.length && cIdx < tempCredits.length) {
      const d = tempDebits[dIdx];
      const c = tempCredits[cIdx];
      const matchAmount = Math.min(d.remainingAmount, c.remainingAmount);

      if (matchAmount > 0) {
        suggestions.push({
          type: "FIFO_SUGGESTION",
          amount: matchAmount,
          lines: [
            {
              lineId: d.lineId, // Now recognized thanks to 'any[]' casting
              entryId: d.entryId,
              date: d.entryDate,
              role: "DEBT",
              amount: d.debit,
            },
            {
              lineId: c.lineId,
              entryId: c.entryId,
              date: c.entryDate,
              role: "PAYMENT",
              amount: c.credit,
            },
          ],
        });
      }

      d.remainingAmount -= matchAmount;
      c.remainingAmount -= matchAmount;

      if (d.remainingAmount <= 0) dIdx++;
      if (c.remainingAmount <= 0) cIdx++;
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
    console.error("Lettering Suggestion Error:", error);
    return toLambdaResponse(
      badRequest(i18n.getMessage("ERROR_SUGGESTIONS_TECHNICAL"))
    );
  }
};
