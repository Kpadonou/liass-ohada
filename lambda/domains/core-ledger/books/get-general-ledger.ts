import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import {
  QueryCommand,
  GetItemCommand,
  ResourceNotFoundException,
} from "@aws-sdk/client-dynamodb";
import { unmarshall, marshall } from "@aws-sdk/util-dynamodb";
import { z } from "zod";
import { I18nResolver } from "@/lambda/shared/i18n";
import {
  ok,
  toLambdaResponse,
  badRequest,
  notFound,
} from "@/models/shared/api-response";
import { dynamoClient } from "@/lambda/shared/dynamo-client";
import { config } from "@/lambda/shared/config";
import { KeyFactory } from "@/lambda/shared/key-builder";

/**
 * Request parameters validation schema
 */
const GetAccountLedgerParamsSchema = z.object({
  orgId: z.string().min(1, "Organization ID is required"),
  fiscalYear: z
    .string()
    .regex(/^\d{4}$/, "Fiscal year must be a 4-digit string"),
  accountId: z
    .string()
    .regex(/^\d{2,8}$/, "Account ID must be numeric with 2-8 digits"),
});

/**
 * Generates the General Ledger for a specific account.
 * It lists all individual transactions (lines) in chronological order
 * and calculates a running balance to track the account's evolution.
 */
export const handler = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  const i18n = new I18nResolver(event.headers["Accept-Language"]);

  try {
    const orgId = event.requestContext.authorizer?.claims?.orgId;
    const fiscalYear = event.queryStringParameters?.fiscalYear;
    const accountId = event.queryStringParameters?.accountId || "";

    const validation = GetAccountLedgerParamsSchema.safeParse({
      orgId,
      fiscalYear,
      accountId,
    });

    if (!validation.success) {
      return toLambdaResponse(
        badRequest(i18n.getMessage("ERROR_INVALID_INPUT")),
      );
    }

    // 1. Verify fiscal year exists using centralized KeyFactory
    const fyResult = await dynamoClient.send(
      new GetItemCommand({
        TableName: config.TABLE_NAME,
        Key: marshall({
          PK: KeyFactory.orgKey(orgId),
          SK: KeyFactory.fiscalYearSK(Number(fiscalYear)),
        }),
      }),
    );

    if (!fyResult.Item) {
      return toLambdaResponse(
        notFound(i18n.getMessage("ERROR_FISCAL_YEAR_NOT_FOUND")),
      );
    }

    // 2. Format account ID (padding depends on your internal standard, usually 8 digits)
    const paddedAccountId = accountId.padEnd(8, "0");

    // 3. Query GSI_ACCOUNT for transaction details
    // We use ScanIndexForward: true to ensure chronological order based on Sort Key
    const queryResult = await dynamoClient.send(
      new QueryCommand({
        TableName: config.TABLE_NAME,
        IndexName: config.GSI_ACCOUNT,
        KeyConditionExpression:
          "GSI1PK = :gsi1pk AND begins_with(GSI1SK, :gsi1sk)",
        ExpressionAttributeValues: marshall({
          ":gsi1pk": KeyFactory.gsi1PK(orgId),
          ":gsi1sk": `ACC#${paddedAccountId}#FY#${fiscalYear}`,
        }),
        ScanIndexForward: true,
      }),
    );

    if (!queryResult.Items || queryResult.Items.length === 0) {
      return toLambdaResponse(
        ok([], i18n.getMessage("INFO_NO_MOVEMENTS_FOUND")),
      );
    }

    // 4. Processing entries and Running Balance calculation
    let runningBalance = 0;
    const ledgerEntries = queryResult.Items.map((item) => {
      const line = unmarshall(item);
      const debit = Number(line.debit) || 0;
      const credit = Number(line.credit) || 0;

      // Update cumulative balance
      runningBalance += debit - credit;

      return {
        date: line.entryDate,
        label: line.label || line.description || "-",
        reference: line.entryId || "N/A",
        journal: line.journalCode,
        debit,
        credit,
        runningBalance,
      };
    });

    return toLambdaResponse(
      ok(ledgerEntries, i18n.getMessage("SUCCESS_LEDGER_RETRIEVED")),
    );
  } catch (error) {
    console.error("GetAccountLedger Error:", error);

    if (error instanceof ResourceNotFoundException) {
      return toLambdaResponse(
        notFound(i18n.getMessage("ERROR_ACCOUNT_NOT_FOUND")),
      );
    }

    return toLambdaResponse(badRequest(i18n.getMessage("ERROR_INTERNAL")));
  }
};
