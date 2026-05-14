import { config } from "@/lambda/shared/config";
import { dynamoClient } from "@/lambda/shared/dynamo-client";
import { I18nResolver } from "@/lambda/shared/i18n";
import { KeyFactory } from "@/lambda/shared/key-builder";
import {
  badRequest,
  ok,
  toLambdaResponse,
  unauthorized,
} from "@/models/shared/api-response";
import { QueryCommand } from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";

/**
 * Interface representing a line being processed by the FIFO algorithm.
 * Extends the record with a tracking field for the remaining amount to match.
 */
interface FIFOCandidate {
  lineId: string;
  entryId: string;
  entryDate: string;
  debit: number;
  credit: number;
  label?: string;
  projectId?: string;
  remainingAmount: number;
}

/**
 * Retrieves unlettered transaction lines and provides smart matching suggestions.
 * Uses KeyFactory for GSI3 (Lettering Index) and supports SYCEBNL project filtering.
 * * @param event - APIGatewayProxyEvent containing orgId, accountId, thirdPartyId, and optional projectId.
 */
export const handler = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  const i18n = new I18nResolver(event.headers["Accept-Language"] || "en");

  try {
    const orgId = event.requestContext?.authorizer?.claims?.orgId;
    const { accountId, thirdPartyId, projectId } =
      event.queryStringParameters || {};

    if (!orgId) {
      return toLambdaResponse(unauthorized());
    }

    if (!accountId || !thirdPartyId) {
      return toLambdaResponse(
        badRequest(i18n.getMessage("ERROR_MISSING_PARAMETERS")),
      );
    }

    // 1. Prepare Query for GSI3 (Lettering Index)
    const queryInput: any = {
      TableName: config.TABLE_NAME,
      IndexName: config.GSI3,
      KeyConditionExpression: "GSI3PK = :lpk AND begins_with(GSI3SK, :lsk)",
      ExpressionAttributeValues: {
        ":lpk": { S: KeyFactory.letteringPK(orgId, accountId, thirdPartyId) },
        ":lsk": { S: "UNLETTERED#" },
      },
    };

    // SYCEBNL Enhancement: Analytical filter by projectId
    if (projectId) {
      queryInput.FilterExpression = "projectId = :pid";
      queryInput.ExpressionAttributeValues[":pid"] = { S: projectId };
    }

    const { Items } = await dynamoClient.send(new QueryCommand(queryInput));
    const unletteredLines = (Items || []).map((item) => unmarshall(item));

    if (unletteredLines.length === 0) {
      return toLambdaResponse(
        ok(
          { totalUnlettered: 0, suggestions: [] },
          i18n.getMessage("INFO_NO_LINES_TO_MATCH"),
        ),
      );
    }

    // 2. Data Segregation
    const debits = unletteredLines.filter((l) => (Number(l.debit) || 0) > 0);
    const credits = unletteredLines.filter((l) => (Number(l.credit) || 0) > 0);

    const suggestions: any[] = [];
    const matchedIds = new Set<string>();

    // --- STRATEGY 1: PERFECT MATCH ---
    for (const d of debits) {
      const match = credits.find(
        (c) =>
          Number(c.credit) === Number(d.debit) && !matchedIds.has(c.lineId),
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
              label: d.label,
              amount: d.debit,
              type: "DEBIT",
              projectId: d.projectId,
            },
            {
              lineId: match.lineId,
              entryId: match.entryId,
              date: match.entryDate,
              label: match.label,
              amount: match.credit,
              type: "CREDIT",
              projectId: match.projectId,
            },
          ],
        });
      }
    }

    // --- STRATEGY 2: FIFO (Chronological) ---
    // Prepare temporary candidates with explicit FIFOCandidate typing to resolve TS errors
    const tempDebits: FIFOCandidate[] = debits
      .filter((d) => !matchedIds.has(d.lineId))
      .sort((a, b) => a.entryDate.localeCompare(b.entryDate))
      .map(
        (d) => ({ ...d, remainingAmount: Number(d.debit) }) as FIFOCandidate,
      );

    const tempCredits: FIFOCandidate[] = credits
      .filter((c) => !matchedIds.has(c.lineId))
      .sort((a, b) => a.entryDate.localeCompare(b.entryDate))
      .map(
        (c) => ({ ...c, remainingAmount: Number(c.credit) }) as FIFOCandidate,
      );

    let dIdx = 0;
    let cIdx = 0;

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
              lineId: d.lineId,
              entryId: d.entryId,
              date: d.entryDate,
              amount: d.debit,
              projectId: d.projectId,
            },
            {
              lineId: c.lineId,
              entryId: c.entryId,
              date: c.entryDate,
              amount: c.credit,
              projectId: c.projectId,
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
          unletteredLines,
          suggestions,
        },
        i18n.getMessage("SUCCESS_SUGGESTIONS_RETRIEVED"),
      ),
    );
  } catch (error) {
    console.error("GetUnletteredLines Error:", error);
    return toLambdaResponse(
      badRequest(i18n.getMessage("ERROR_SUGGESTIONS_TECHNICAL")),
    );
  }
};
