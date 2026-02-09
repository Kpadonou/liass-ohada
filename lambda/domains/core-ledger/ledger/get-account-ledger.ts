import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import {
  QueryCommand,
  GetItemCommand,
  ResourceNotFoundException,
} from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import { z } from "zod";
import { I18nResolver } from "../../../shared/i18n";
import {
  ok,
  toLambdaResponse,
  badRequest,
  notFound,
} from "../../../../models/shared/api-response";
import { dynamoClient } from "../../../shared/dynamo-client";
import { config } from "../../../shared/config";

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

type GetAccountLedgerParams = z.infer<typeof GetAccountLedgerParamsSchema>;

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  const i18n = new I18nResolver(event.headers["Accept-Language"]);

  try {
    // Extract and validate input parameters
    const orgId = event.requestContext.authorizer?.claims?.orgId || "test-org";
    const fiscalYear = event.queryStringParameters?.fiscalYear || "2024";
    const accountId = event.queryStringParameters?.accountId || "";

    // Validate input parameters using Zod schema
    const validation = GetAccountLedgerParamsSchema.safeParse({
      orgId,
      fiscalYear,
      accountId,
    });

    if (!validation.success) {
      return toLambdaResponse(
        badRequest(i18n.getMessage("ERROR_INVALID_INPUT"))
      );
    }

    // Verify fiscal year exists
    const fiscalYearKey = await dynamoClient.send(
      new GetItemCommand({
        TableName: config.TABLE_NAME,
        Key: {
          PK: { S: `ORG#${orgId}` },
          SK: { S: `FY#${fiscalYear}` },
        },
      })
    );

    if (!fiscalYearKey.Item) {
      return toLambdaResponse(
        notFound(i18n.getMessage("ERROR_FISCAL_YEAR_NOT_FOUND"))
      );
    }

    // Pad account number to 8 digits
    const paddedAccountId = accountId.padEnd(8, "0");

    // Query the GSI_ACCOUNT to get all entries for this account in the fiscal year
    const queryResult = await dynamoClient.send(
      new QueryCommand({
        TableName: config.TABLE_NAME,
        IndexName: "GSI_ACCOUNT",
        KeyConditionExpression:
          "GSI1PK = :gsi1pk AND begins_with(GSI1SK, :gsi1sk)",
        ExpressionAttributeValues: {
          // 1. Utilise la PK de l'organisation uniquement
          ":gsi1pk": { S: `ORG#${orgId}` },
          // 2. Filtre par compte ET par année dans la GSI1SK
          ":gsi1sk": { S: `ACC#${paddedAccountId}#FY#${fiscalYear}` },
        },
        ScanIndexForward: true,
      })
    );

    const ledgerEntries: any[] = [];
    let runningBalance = 0;

    // Process the results and calculate running balance
    if (!queryResult.Items || queryResult.Items.length === 0) {
      // Return empty array with INFO message if no movements found
      return toLambdaResponse(
        ok(ledgerEntries, i18n.getMessage("INFO_NO_MOVEMENTS_FOUND"))
      );
    }

    // Process ledger entries and calculate running balance
    for (const item of queryResult.Items) {
      const line = unmarshall(item);

      // Calculate running balance (debit increases, credit decreases for asset accounts)
      // This is a simplified calculation - in reality, you'd need to know the account type
      const debit = line.debit || 0;
      const credit = line.credit || 0;
      runningBalance += debit - credit;

      ledgerEntries.push({
        date: line.entryDate,
        label: line.description || "-",
        reference: line.voucherNumber || line.entryId || "N/A",
        debit: debit,
        credit: credit,
        runningBalance: runningBalance,
      });
    }

    return toLambdaResponse(
      ok(ledgerEntries, i18n.getMessage("SUCCESS_LEDGER_RETRIEVED"))
    );
  } catch (error) {
    console.error("GetAccountLedger Error:", error);

    // Handle specific DynamoDB errors
    if (error instanceof ResourceNotFoundException) {
      return toLambdaResponse(
        notFound(i18n.getMessage("ERROR_ACCOUNT_NOT_FOUND"))
      );
    }

    // Handle validation errors
    if (error instanceof z.ZodError) {
      return toLambdaResponse(
        badRequest(i18n.getMessage("ERROR_INVALID_INPUT"))
      );
    }

    // Default error response
    return toLambdaResponse(badRequest(i18n.getMessage("ERROR_INTERNAL")));
  }
};
