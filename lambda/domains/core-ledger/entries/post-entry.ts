import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import {
  TransactWriteItemsCommand,
  GetItemCommand,
  BatchGetItemCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import {
  EntrySchema,
  CreateEntryRequestSchema,
} from "@/models/core-ledger/entry";
import { EntryLineSchema } from "@/models/core-ledger/entry-line";
import { FiscalYearSchema } from "@/models/core-ledger/fiscal-year";
import { KeyFactory } from "@/lambda/shared/key-builder";
import { I18nResolver } from "@/lambda/shared/i18n";
import {
  badRequest,
  created,
  toLambdaResponse,
} from "@/models/shared/api-response";
import { dynamoClient } from "@/lambda/shared/dynamo-client";
import { config } from "@/lambda/shared/config";

const formatAccount = (acc: string) => acc.padStart(8, "0");

/**
 * Posts a multi-line accounting entry to the ledger using an atomic transaction.
 * It validates:
 * 1. Fiscal Year status (must be OPEN).
 * 2. Monthly Period Lock (must be OPEN).
 * 3. Account existence (via BatchGetItem).
 * 4. Double-entry balance (Total Debit must equal Total Credit).
 * It populates GSIs for the General Ledger (GSI1) and Third-party tracking (GSI2).
 */
export const handler = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  const i18n = new I18nResolver(event.headers["Accept-Language"]);
  try {
    const body = JSON.parse(event.body || "{}");
    const inputValidation = CreateEntryRequestSchema.safeParse(body);
    if (!inputValidation.success)
      return toLambdaResponse(
        badRequest(i18n.getMessage("ERROR_INVALID_INPUT")),
      );

    const orgId =
      event.requestContext?.authorizer?.claims?.orgId ||
      inputValidation.data.orgId;
    const year = inputValidation.data.year;
    if (!orgId || year === undefined) {
      return toLambdaResponse(
        badRequest(i18n.getMessage("ERROR_MISSING_PARAMETERS")),
      );
    }
    const {
      entryType = "STANDARD",
      journalCode = "MISC",
      label: headerLabel,
      lines = [],
    } = inputValidation.data;
    const entryDate =
      inputValidation.data.entryDate || new Date().toISOString().split("T")[0];

    // --- Entry ID Generation Logic based on Entry Type ---
    let entryId = inputValidation.data.entryId;
    if (!entryId) {
      const timestamp = Date.now();
      switch (entryType) {
        case "OPENING":
          entryId = `OPEN-${year}`;
          break;
        case "ADJUSTMENT":
          entryId = `ADJ-${year}-${timestamp}`;
          break;
        case "CLOSING":
          entryId = `CLOSE-${year}`;
          break;
        default:
          entryId = `ENT-${timestamp}`;
      }
    }

    // 1. Fiscal Year Check: Ensure the year exists and is not locked/closed
    const fyResult = await dynamoClient.send(
      new GetItemCommand({
        TableName: config.TABLE_NAME,
        Key: marshall({
          PK: KeyFactory.orgKey(orgId),
          SK: KeyFactory.fiscalYearSK(year),
        }),
      }),
    );
    if (!fyResult.Item)
      return toLambdaResponse(
        badRequest(i18n.getMessage("ERROR_FISCAL_YEAR_NOT_FOUND")),
      );

    const fiscalYear = FiscalYearSchema.parse(unmarshall(fyResult.Item));
    if (fiscalYear.status === "LOCKED" || fiscalYear.status === "CLOSED") {
      return toLambdaResponse(
        badRequest(i18n.getMessage("ERROR_FISCAL_YEAR_LOCKED")),
      );
    }

    // 2. Monthly Period Lock Check
    const month = entryDate.split("-")[1];

    const lockResult = await dynamoClient.send(
      new GetItemCommand({
        TableName: config.TABLE_NAME,
        // On utilise le PK de l'année et un SK spécifique au verrou du mois
        Key: marshall({
          PK: KeyFactory.partitionKey(orgId, year),
          SK: KeyFactory.periodLockSK(month),
        }),
      }),
    );

    if (lockResult.Item) {
      const lockData = unmarshall(lockResult.Item);
      if (lockData.status === "LOCKED") {
        return toLambdaResponse(
          badRequest(i18n.getMessage("ERROR_PERIOD_LOCKED")),
        );
      }
    }

    // 3. Batch Account Validation: Verify all accounts in lines are valid
    const uniqueAccountIds = [
      ...new Set(lines.map((l: any) => formatAccount(l.accountId))),
    ];
    const batchResults = await dynamoClient.send(
      new BatchGetItemCommand({
        RequestItems: {
          [config.TABLE_NAME]: {
            Keys: uniqueAccountIds.map((accId) =>
              marshall({
                PK: KeyFactory.orgKey(orgId),
                SK: KeyFactory.accountSK(accId),
              }),
            ),
          },
        },
      }),
    );

    const foundAccounts = new Set(
      (batchResults.Responses?.[config.TABLE_NAME] || []).map(
        (item) => unmarshall(item).accountId,
      ),
    );

    for (const accId of uniqueAccountIds) {
      if (!foundAccounts.has(accId)) {
        return toLambdaResponse(
          badRequest(i18n.getMessage("ERROR_ACCOUNT_NOT_FOUND")),
        );
      }
    }

    // 4. Process Individual Entry Lines
    let totalDebit = 0,
      totalCredit = 0;
    const transactItems: any[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const paddedAcc = formatAccount(line.accountId);
      const lineId = `LINE-${Date.now()}-${Math.random()
        .toString(36)
        .substring(2, 7)}`;

      const lineItem: any = {
        orgId,
        year,
        lineId,
        entryId,
        accountId: paddedAcc,
        thirdPartyId: line.thirdPartyId,
        label: line.label || headerLabel,
        debit: Math.round(Number(line.debit) || 0),
        credit: Math.round(Number(line.credit) || 0),
        entryDate,
        journalCode,
        entityType: "ENTRY_LINE",
        PK: KeyFactory.partitionKey(orgId, year),
        SK: KeyFactory.entryLineSK(lineId),
        GSI1PK: KeyFactory.gsi1PK(orgId),
        GSI1SK: KeyFactory.gsi1SK(paddedAcc, year, entryDate, lineId),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      // Handle Third-party specific GSIs and Lettering keys if applicable
      if (line.thirdPartyId) {
        lineItem.GSI2PK = KeyFactory.gsi2PK(
          orgId,
          paddedAcc,
          line.thirdPartyId,
        );
        lineItem.GSI2SK = KeyFactory.gsi2SK(entryDate, lineId);
        lineItem.L_PK = KeyFactory.letteringPK(
          orgId,
          paddedAcc,
          line.thirdPartyId,
        );
        lineItem.L_SK = KeyFactory.letteringSK(entryDate, entryId, i);
      }

      transactItems.push({
        Put: {
          TableName: config.TABLE_NAME,
          Item: marshall(EntryLineSchema.parse(lineItem), {
            removeUndefinedValues: true,
          }),
        },
      });
      totalDebit += lineItem.debit;
      totalCredit += lineItem.credit;
    }

    // 5. Integrity Check: Double-Entry Balancing
    if (totalDebit !== totalCredit)
      return toLambdaResponse(
        badRequest(i18n.getMessage("ERROR_ENTRY_NOT_BALANCED")),
      );

    // 6. Finalize Entry Header and Execute Transaction
    const entryHeader = {
      orgId,
      year,
      entryId,
      entryType,
      entryDate,
      totalDebit,
      totalCredit,
      label: headerLabel,
      journalCode,
      status: "POSTED",
      entityType: "ENTRY",
      PK: KeyFactory.partitionKey(orgId, year),
      SK: KeyFactory.entrySK(entryId),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    transactItems.unshift({
      Put: {
        TableName: config.TABLE_NAME,
        Item: marshall(EntrySchema.parse(entryHeader), {
          removeUndefinedValues: true,
        }),
      },
    });

    await dynamoClient.send(
      new TransactWriteItemsCommand({ TransactItems: transactItems }),
    );
    return toLambdaResponse(
      created(entryHeader, i18n.getMessage("SUCCESS_ENTRY_POSTED")),
    );
  } catch (error) {
    console.error("PostEntry Error:", error);
    return toLambdaResponse(badRequest(i18n.getMessage("ERROR_INTERNAL")));
  }
};
