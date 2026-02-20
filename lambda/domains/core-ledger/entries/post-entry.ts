import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import {
  TransactWriteItemsCommand,
  GetItemCommand,
  BatchGetItemCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import {
  EntrySchema,
  EntryLineSchema,
  CreateEntryRequestSchema,
} from "@/models/core-ledger/entry";
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
import { LockService } from "@/lambda/shared/services/lock-service";

const formatAccount = (acc: string) => acc.padStart(8, "0");

/**
 * Posts an accounting entry with SYCEBNL project tracking support.
 * Orchestrates a multi-item transaction to ensure data integrity across:
 * 1. General Ledger (GSI1)
 * 2. Auxiliary Ledger (GSI2)
 * 3. Lettering Sparse Index (GSI3)
 * 4. Project Analytical Ledger (GSI4 - SYCEBNL)
 */
export const handler = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  const i18n = new I18nResolver(event.headers["Accept-Language"]);
  try {
    const body = JSON.parse(event.body || "{}");
    const inputValidation = CreateEntryRequestSchema.safeParse(body);

    if (!inputValidation.success) {
      return toLambdaResponse(
        badRequest(i18n.getMessage("ERROR_INVALID_INPUT")),
      );
    }

    const {
      orgId: inputOrgId,
      year,
      entryType = "STANDARD",
      journalCode = "MISC",
      label: headerLabel,
      lines = [],
      entryDate: inputDate,
      voucherNumber,
    } = inputValidation.data;

    const orgId = event.requestContext?.authorizer?.claims?.orgId || inputOrgId;
    const entryDate = inputDate || new Date().toISOString().split("T")[0];

    if (!orgId || year === undefined) {
      return toLambdaResponse(
        badRequest(i18n.getMessage("ERROR_MISSING_PARAMETERS")),
      );
    }

    // --- Entry ID Generation ---
    const timestamp = Date.now();
    const entryId =
      inputValidation.data.entryId ||
      (entryType === "STANDARD"
        ? `ENT-${timestamp}`
        : `${entryType}-${year}-${timestamp}`);

    // 1. Fiscal Year & Period Validation
    const fyResult = await dynamoClient.send(
      new GetItemCommand({
        TableName: config.TABLE_NAME,
        Key: marshall({
          PK: KeyFactory.orgKey(orgId),
          SK: KeyFactory.fiscalYearSK(year),
        }),
      }),
    );

    if (!fyResult.Item) {
      return toLambdaResponse(
        badRequest(i18n.getMessage("ERROR_FISCAL_YEAR_NOT_FOUND")),
      );
    }

    const fiscalYear = FiscalYearSchema.parse(unmarshall(fyResult.Item));
    if (fiscalYear.status !== "OPEN") {
      return toLambdaResponse(
        badRequest(i18n.getMessage("ERROR_FISCAL_YEAR_LOCKED")),
      );
    }

    // 2. Monthly Lock Check
    const isLocked = await LockService.isPeriodLocked(orgId, entryDate);
    if (isLocked) {
      return toLambdaResponse(
        badRequest(i18n.getMessage("ERROR_PERIOD_LOCKED")),
      );
    }

    // 3. Accounts Verification
    const uniqueAccountIds = [
      ...new Set(lines.map((l) => formatAccount(l.accountId))),
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

    if (foundAccounts.size !== uniqueAccountIds.length) {
      return toLambdaResponse(
        badRequest(i18n.getMessage("ERROR_ACCOUNT_NOT_FOUND")),
      );
    }

    // 4. Building Transaction Items
    let totalDebit = 0;
    let totalCredit = 0;
    const transactItems: any[] = [];
    const now = new Date().toISOString();

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const paddedAcc = formatAccount(line.accountId);
      const lineId = `L${i + 1}-${timestamp}`;

      const lineItem: any = {
        orgId,
        year,
        lineId,
        entryId,
        accountId: paddedAcc,
        projectId: line.projectId,
        thirdPartyId: line.thirdPartyId,
        label: line.label || headerLabel,
        description: line.description,
        debit: Math.round(line.debit || 0),
        credit: Math.round(line.credit || 0),
        entryDate,
        journalCode,
        voucherNumber,
        entityType: "ENTRY_LINE",
        PK: KeyFactory.partitionKey(orgId, year),
        SK: KeyFactory.entryLineSK(lineId),
        GSI1PK: KeyFactory.gsi1PK(orgId),
        GSI1SK: KeyFactory.gsi1SK(paddedAcc, year, entryDate, lineId),
        createdAt: now,
        updatedAt: now,
      };

      // GSI2 & GSI3: Third Party & Lettering
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
        lineItem.L_SK = KeyFactory.letteringSK(entryDate, entryId, lineId);
      }

      // GSI4: Project Analytical Index (SYCEBNL)
      if (line.projectId) {
        lineItem.GSI4PK = KeyFactory.gsi4PK(orgId, line.projectId);
        lineItem.GSI4SK = KeyFactory.gsi4SK(year, entryDate, lineId);
      }

      const validatedLine = EntryLineSchema.parse(lineItem);

      transactItems.push({
        Put: {
          TableName: config.TABLE_NAME,
          Item: marshall(validatedLine, {
            removeUndefinedValues: true,
          }),
        },
      });

      totalDebit += lineItem.debit;
      totalCredit += lineItem.credit;
    }

    // 5. Balance Check
    if (totalDebit !== totalCredit) {
      return toLambdaResponse(
        badRequest(i18n.getMessage("ERROR_ENTRY_NOT_BALANCED")),
      );
    }

    // 6. Header Item
    const entryHeader = {
      orgId,
      year,
      entryId,
      entryType,
      entryDate,
      label: headerLabel,
      journalCode,
      voucherNumber,
      totalDebit,
      totalCredit,
      status: "POSTED",
      entityType: "ENTRY",
      PK: KeyFactory.partitionKey(orgId, year),
      SK: KeyFactory.entrySK(entryId),
      createdAt: now,
      updatedAt: now,
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
