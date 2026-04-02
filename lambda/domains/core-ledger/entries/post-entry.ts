/**
 * @description Atomic handler for posting accounting entries.
 * It ensures strict consistency between the Journal (Entry/Lines) and the
 * Trial Balance (Account Balances) using DynamoDB TransactWriteItems.
 * * Business Rules:
 * - Validates fiscal year status and period locks.
 * - Enforces budget constraints for project-related lines.
 * - Ensures the entry is balanced (Total Debit = Total Credit).
 * - Updates pre-aggregated account balances in real-time.
 */
import { config } from "@/lambda/shared/config";
import { dynamoClient } from "@/lambda/shared/dynamo-client";
import { KeyFactory } from "@/lambda/shared/key-builder";
import {
  AppError,
  createHandler,
} from "@/lambda/shared/middleware/handler-wrapper";
import { BalanceService } from "@/lambda/shared/services/balance-service";
import { BudgetService } from "@/lambda/shared/services/budget-service";
import { LedgerService } from "@/lambda/shared/services/ledger-service";
import { LockService } from "@/lambda/shared/services/lock-service";
import {
  CreateEntryRequestSchema,
  EntryLineSchema,
  EntrySchema,
} from "@/models/core-ledger/entry";
import { TransactWriteItemsCommand } from "@aws-sdk/client-dynamodb";
import { marshall } from "@aws-sdk/util-dynamodb";

const formatAccount = (acc: string) => acc.padEnd(8, "0");

export const handler = createHandler(
  CreateEntryRequestSchema,
  async (data, { orgId, i18n }) => {
    const {
      year,
      entryDate: inputDate,
      lines = [],
      label: headerLabel,
      journalCode = "MISC",
      entryType = "STANDARD",
      voucherNumber,
    } = data;

    // --- 1. PRE-VALIDATIONS ---
    if (lines.length === 0) {
      throw new AppError(400, "ERROR_EMPTY_ENTRY");
    }

    // DynamoDB transaction limit is 100 items.
    // We use 1 for header + 2 per line (Line + Balance Update). Max lines = 49.
    if (lines.length > 49) {
      throw new AppError(400, "ERROR_ENTRY_TOO_LARGE");
    }

    const entryDate = inputDate || new Date().toISOString().split("T")[0];
    const timestamp = Date.now();
    const entryId = data.entryId || `E-${timestamp}`;
    const now = new Date().toISOString();

    // Verify Fiscal Year and Period Lock
    await LedgerService.validateFiscalYear(orgId, year);
    if (await LockService.isPeriodLocked(orgId, entryDate)) {
      throw new AppError(400, "ERROR_PERIOD_LOCKED");
    }

    // --- 2. ENTITY VALIDATION (Accounts & Projects) ---
    const accountIds = [
      ...new Set(lines.map((l) => formatAccount(l.accountId))),
    ];
    const projectIds = [
      ...new Set(
        lines.map((l) => l.projectId).filter((id): id is string => !!id),
      ),
    ];

    await LedgerService.validateEntities(orgId, accountIds, projectIds);

    // --- 3. TRANSACTION CONSTRUCTION ---
    let totalDebit = 0;
    let totalCredit = 0;
    const transactItems: any[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const paddedAcc = formatAccount(line.accountId);
      const lineId = `L${i + 1}-${timestamp}`;

      // SYCEBNL Budget Enforcement
      if (line.projectId && line.debit > 0) {
        await BudgetService.enforceBudget(orgId, year, line);
      }

      // Action A: Create the Entry Line
      const lineItem = buildLineItem(
        orgId,
        year,
        entryId,
        lineId,
        entryDate,
        line,
        paddedAcc,
        journalCode,
        voucherNumber,
        now,
      );

      transactItems.push({
        Put: {
          TableName: config.TABLE_NAME,
          Item: marshall(EntryLineSchema.parse(lineItem), {
            removeUndefinedValues: true,
          }),
        },
      });

      // Action B: Update the Account Balance (Atomic Increment)
      transactItems.push(
        BalanceService.buildBalanceUpdateAction(
          orgId,
          year,
          paddedAcc,
          line.debit || 0,
          line.credit || 0,
          journalCode,
        ),
      );

      totalDebit += Math.round(line.debit || 0);
      totalCredit += Math.round(line.credit || 0);
    }

    // --- 4. BALANCE CHECK ---
    if (totalDebit !== totalCredit) {
      throw new AppError(400, "ERROR_ENTRY_NOT_BALANCED");
    }

    // --- 5. HEADER & EXECUTION ---
    const entryHeader = {
      orgId,
      year,
      entryId,
      entryType,
      entryDate,
      journalCode,
      voucherNumber,
      totalDebit,
      totalCredit,
      label: headerLabel,
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

    return {
      message: i18n.getMessage("SUCCESS_ENTRY_POSTED"),
      entryId,
    };
  },
);

/**
 * Helper to build EntryLine items with complex GSI mappings.
 */
function buildLineItem(
  orgId: string,
  year: number,
  entryId: string,
  lineId: string,
  entryDate: string,
  line: any,
  paddedAcc: string,
  journalCode: string,
  voucherNumber: string | undefined,
  now: string,
) {
  const item: any = {
    orgId,
    year,
    lineId,
    entryId,
    entryDate,
    journalCode,
    voucherNumber,
    accountId: paddedAcc,
    projectId: line.projectId,
    budgetLineId: line.budgetLineId,
    donorId: line.donorId,
    thirdPartyId: line.thirdPartyId,
    label: line.label,
    debit: Math.round(line.debit || 0),
    credit: Math.round(line.credit || 0),
    entityType: "ENTRY_LINE",
    PK: KeyFactory.partitionKey(orgId, year),
    SK: KeyFactory.entryLineSK(lineId),
    GSI1PK: KeyFactory.gsi1PK(orgId),
    GSI1SK: KeyFactory.gsi1SK(paddedAcc, year, entryDate, lineId),
    createdAt: now,
    updatedAt: now,
  };

  if (line.thirdPartyId) {
    item.GSI2PK = KeyFactory.gsi2PK(orgId, paddedAcc, line.thirdPartyId);
    item.GSI2SK = KeyFactory.gsi2SK(entryDate, lineId);
    item.L_PK = KeyFactory.letteringPK(orgId, paddedAcc, line.thirdPartyId);
    item.L_SK = KeyFactory.letteringSK(entryDate, entryId, lineId);
  }

  if (line.projectId) {
    item.GSI4PK = KeyFactory.gsi4PK(orgId);
    item.GSI4SK = KeyFactory.gsi4SK(line.projectId, year, entryDate, lineId);
  }

  return item;
}
