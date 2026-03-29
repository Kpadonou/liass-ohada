import { config } from "@/lambda/shared/config";
import { dynamoClient } from "@/lambda/shared/dynamo-client";
import { KeyFactory } from "@/lambda/shared/key-builder";
import {
  AppError,
  createHandler,
} from "@/lambda/shared/middleware/handler-wrapper";
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

const formatAccount = (acc: string) => acc.padStart(8, "0");

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

    const entryDate = inputDate || new Date().toISOString().split("T")[0];
    const timestamp = Date.now();
    const entryId =
      data.entryId ||
      (entryType === "STANDARD"
        ? `E-${timestamp}`
        : `${entryType}-${year}-${timestamp}`);
    const now = new Date().toISOString();

    // --- 1. VALIDATIONS D'ENVIRONNEMENT ---
    await LedgerService.validateFiscalYear(orgId, year); //

    if (await LockService.isPeriodLocked(orgId, entryDate)) {
      throw new AppError(400, "ERROR_PERIOD_LOCKED"); //
    }

    // --- 2. VALIDATION DES COMPTES ET PROJETS ---
    const accountIds = [
      ...new Set(lines.map((l) => formatAccount(l.accountId))),
    ];
    const projectIds = [
      ...new Set(
        lines.map((l) => l.projectId).filter((id): id is string => !!id),
      ),
    ];

    await LedgerService.validateEntities(orgId, accountIds, projectIds); //

    // --- 3. CONSTRUCTION DE LA TRANSACTION ---
    let totalDebit = 0;
    let totalCredit = 0;
    const transactItems: any[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const paddedAcc = formatAccount(line.accountId);
      const lineId = `L${i + 1}-${timestamp}`;

      // Validation Budgétaire SYCEBNL (Jette une AppError si échec)
      if (line.projectId && line.debit > 0) {
        await BudgetService.enforceBudget(orgId, year, line); //
      }

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

      totalDebit += Math.round(line.debit || 0);
      totalCredit += Math.round(line.credit || 0);
    }

    // --- 4. VÉRIFICATION ÉQUILIBRE ---
    if (totalDebit !== totalCredit) {
      throw new AppError(400, "ERROR_ENTRY_NOT_BALANCED"); //
    }

    // --- 5. ENTÊTE ET EXÉCUTION ---
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
 * Helper interne pour la construction des index complexes (GSI1, 2, 4)
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
