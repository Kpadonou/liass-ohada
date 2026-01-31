import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import {
  TransactWriteItemsCommand,
  GetItemCommand,
  QueryCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { EntrySchema, EntryType } from "@/models/core-ledger/entry";
import { EntryLineSchema } from "@/models/core-ledger/entry-line";
import { FiscalYearSchema } from "@/models/core-ledger/fiscal-year";
import { KeyFactory } from "../../../shared/key-builder";
import { I18nResolver } from "../../../shared/i18n";
import {
  badRequest,
  created,
  toLambdaResponse,
} from "@/models/shared/api-response";
import { dynamoClient } from "../../../shared/dynamo-client";
import { config } from "../../../shared/config";

/**
 * Extract class code from accountId (8-digit padded)
 * Class codes are 1-8, stored as first digit
 */
const getAccountClassCode = (accountId: string): number => {
  return parseInt(accountId.charAt(0), 10);
};

/**
 * Check if an account is a Balance Sheet account (Classes 1-5)
 */
const isBalanceSheetAccount = (accountId: string): boolean => {
  const classCode = getAccountClassCode(accountId);
  return classCode >= 1 && classCode <= 5;
};

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    const body = JSON.parse(event.body || "{}");
    const orgId = event.requestContext.authorizer?.claims?.orgId || "test-org";
    const userId =
      event.requestContext.authorizer?.claims?.userId || "user-123";
    const year = parseInt(body.year);
    const entryType: string = body.entryType || "STANDARD";
    const entryDate = body.entryDate || new Date().toISOString().split("T")[0]; // ISO Date (YYYY-MM-DD)
    const journalCode = body.journalCode || "MISC";

    // Check FiscalYear status
    const fyPk = KeyFactory.orgKey(orgId);
    const fySk = `FY#${year}`;
    const fyResult = await dynamoClient.send(
      new GetItemCommand({
        TableName: config.TABLE_NAME,
        Key: { pk: { S: fyPk }, sk: { S: fySk } },
      })
    );
    if (!fyResult.Item) {
      const i18n = new I18nResolver(event.headers["Accept-Language"]);
      return toLambdaResponse(
        badRequest(i18n.getMessage("ERROR_FISCAL_YEAR_NOT_FOUND"))
      );
    }
    const fiscalYear = FiscalYearSchema.parse(unmarshall(fyResult.Item));
    if (fiscalYear.status === "LOCKED" || fiscalYear.status === "CLOSED") {
      const i18n = new I18nResolver(event.headers["Accept-Language"]);
      return toLambdaResponse(
        badRequest(i18n.getMessage("ERROR_FISCAL_YEAR_LOCKED"))
      );
    }

    // Opening Entry validation
    let entryId: string;
    if (entryType === "OPENING") {
      // 1. Must be first entry of the fiscal year
      const fyPartitionPk = KeyFactory.partitionKey(orgId, year);
      const queryResult = await dynamoClient.send(
        new QueryCommand({
          TableName: config.TABLE_NAME,
          KeyConditionExpression: "pk = :pk",
          ExpressionAttributeValues: {
            ":pk": { S: fyPartitionPk },
          },
          Limit: 1,
        })
      );
      if (queryResult.Items && queryResult.Items.length > 0) {
        const i18n = new I18nResolver(event.headers["Accept-Language"]);
        return toLambdaResponse(
          badRequest(i18n.getMessage("ERROR_OPENING_ENTRY_NOT_FIRST"))
        );
      }

      // 2. Verify date is first day of fiscal year
      if (entryDate !== fiscalYear.startDate) {
        const i18n = new I18nResolver(event.headers["Accept-Language"]);
        return toLambdaResponse(
          badRequest(i18n.getMessage("ERROR_OPENING_ENTRY_DATE_MISMATCH"))
        );
      }

      // 3. All lines must target Balance Sheet accounts (Classes 1-5)
      const linesToValidate = body.lines || [];
      for (const line of linesToValidate) {
        if (!isBalanceSheetAccount(line.accountId)) {
          const i18n = new I18nResolver(event.headers["Accept-Language"]);
          return toLambdaResponse(
            badRequest(
              i18n.getMessage("ERROR_OPENING_ENTRY_INVALID_ACCOUNT_CLASS")
            )
          );
        }
      }

      // Generate opening entry ID: OPEN-YYYY
      entryId = `OPEN-${year}`;
    } else {
      entryId = body.entryId || `ENT-${Date.now()}`;
    }

    const lines = body.lines || [];
    let totalDebit = 0;
    let totalCredit = 0;

    const transactItems = [];

    // Entry
    const entryData = {
      orgId,
      year,
      entryId,
      entryType,
      voucherNumber: body.voucherNumber,
      journalCode,
      entryDate,
      totalDebit: 0, // Will be updated after summing lines
      totalCredit: 0,
      status: "POSTED",
      entityType: "ENTRY",
      pk: KeyFactory.partitionKey(orgId, year),
      sk: KeyFactory.entrySK(entryId),
      createdBy: userId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    for (const line of lines) {
      // Ensure all amounts are integers
      const debit = parseInt(line.debit) || 0;
      const credit = parseInt(line.credit) || 0;

      // Verify non-negative (accounting rule)
      if (debit < 0 || credit < 0) {
        const i18n = new I18nResolver(event.headers["Accept-Language"]);
        return toLambdaResponse(
          badRequest(i18n.getMessage("ERROR_INVALID_INPUT"))
        );
      }

      totalDebit += debit;
      totalCredit += credit;

      const lineId = `LINE-${Date.now()}-${Math.random()}`;
      const lineData = {
        orgId,
        year,
        lineId,
        entryId,
        accountId: line.accountId,
        projectId: line.projectId,
        debit, // Guaranteed integer
        credit, // Guaranteed integer
        description: line.description || "",
        entryDate,
        thirdPartyId: line.thirdPartyId,
        voucherNumber: body.voucherNumber,
        journalCode,
        matchId: line.matchId,
        entityType: "ENTRY_LINE",
        pk: KeyFactory.partitionKey(orgId, year),
        sk: KeyFactory.entryLineSK(lineId),
        createdBy: userId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const lineValidation = EntryLineSchema.safeParse(lineData);
      if (!lineValidation.success) {
        const i18n = new I18nResolver(event.headers["Accept-Language"]);
        return toLambdaResponse(
          badRequest(i18n.getMessage("ERROR_INVALID_INPUT"))
        );
      }

      transactItems.push({
        Put: {
          TableName: config.TABLE_NAME,
          Item: marshall(lineValidation.data, { removeUndefinedValues: true }),
        },
      });
    }

    // Strict integer double-entry check
    if (totalDebit !== totalCredit) {
      const i18n = new I18nResolver(event.headers["Accept-Language"]);
      return toLambdaResponse(
        badRequest(i18n.getMessage("ERROR_ENTRY_NOT_BALANCED"))
      );
    }

    entryData.totalDebit = totalDebit;
    entryData.totalCredit = totalCredit;

    const entryValidation = EntrySchema.safeParse(entryData);
    if (!entryValidation.success) {
      const i18n = new I18nResolver(event.headers["Accept-Language"]);
      return toLambdaResponse(
        badRequest(i18n.getMessage("ERROR_INVALID_INPUT"))
      );
    }

    transactItems.unshift({
      Put: {
        TableName: config.TABLE_NAME,
        Item: marshall(entryValidation.data, { removeUndefinedValues: true }),
      },
    });

    await dynamoClient.send(
      new TransactWriteItemsCommand({
        TransactItems: transactItems,
      })
    );

    const i18n = new I18nResolver(event.headers["Accept-Language"]);
    return toLambdaResponse(
      created(entryValidation.data, i18n.getMessage("SUCCESS_ENTRY_POSTED"))
    );
  } catch (error) {
    console.error(error);
    const i18n = new I18nResolver(event.headers["Accept-Language"]);
    return toLambdaResponse(badRequest(i18n.getMessage("ERROR_INTERNAL")));
  }
};
