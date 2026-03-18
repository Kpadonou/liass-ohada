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
import { BudgetService } from "@/lambda/shared/services/budget-service";

const formatAccount = (acc: string) => acc.padStart(8, "0");

/**
 * Posts an accounting entry with SYCEBNL project tracking support.
 * Orchestrates a multi-item transaction to ensure data integrity across:
 * 1. General Ledger (GSI1): Account-based indexing.
 * 2. Auxiliary Ledger (GSI2): Third-party balances.
 * 3. Lettering Index (GSI3): Entry reconciliation.
 * 4. Project Analytical Ledger (GSI4): SYCEBNL project and donor reporting.
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
        ? `E-${timestamp}`
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

    // 3. Accounts & Projects Verification
    const uniqueAccountIds = [
      ...new Set(lines.map((l) => formatAccount(l.accountId))),
    ];
    // Collecter les projectId uniques (en filtrant les valeurs nulles/indéfinies)
    const uniqueProjectIds = [
      ...new Set(
        lines.map((l) => l.projectId).filter((id): id is string => !!id), // Type guard: élimine les undefined et assure le type string
      ),
    ];

    const batchResults = await dynamoClient.send(
      new BatchGetItemCommand({
        RequestItems: {
          [config.TABLE_NAME]: {
            Keys: [
              ...uniqueAccountIds.map((accId) =>
                marshall({
                  PK: KeyFactory.orgKey(orgId),
                  SK: KeyFactory.accountSK(accId),
                }),
              ),
              ...uniqueProjectIds.map((projId) =>
                marshall({
                  PK: KeyFactory.orgKey(orgId),
                  SK: KeyFactory.projectSK(projId),
                }),
              ),
            ],
          },
        },
      }),
    );

    const responses = batchResults.Responses?.[config.TABLE_NAME] || [];

    // Extraire les IDs trouvés pour validation
    const foundAccounts = new Set();
    const foundProjects = new Set();

    responses.forEach((item) => {
      const data = unmarshall(item);
      if (data.entityType === "ACCOUNT") foundAccounts.add(data.accountId);
      if (data.entityType === "PROJECT") foundProjects.add(data.projectId);
    });

    // Validation des comptes
    if (foundAccounts.size !== uniqueAccountIds.length) {
      return toLambdaResponse(
        badRequest(i18n.getMessage("ERROR_ACCOUNT_NOT_FOUND")),
      );
    }

    // Validation des projets
    if (foundProjects.size !== uniqueProjectIds.length) {
      return toLambdaResponse(
        badRequest(i18n.getMessage("ERROR_PROJECT_NOT_FOUND")),
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
        budgetLineId: line.budgetLineId,
        donorId: line.donorId,
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
        lineItem.GSI4PK = KeyFactory.gsi4PK(orgId);
        lineItem.GSI4SK = KeyFactory.gsi4SK(
          line.projectId,
          year,
          entryDate,
          lineId,
        );
      }

      const validatedLine = EntryLineSchema.parse(lineItem);

      // --- 3.5 Validation Budgétaire et Multi-Bailleur ---
      for (const line of lines) {
        // On ne contrôle que les lignes de dépenses (débit > 0) liées à un projet
        if (line.projectId && line.budgetLineId && line.debit > 0) {
          const budgetStatus = await BudgetService.getAvailableBudget(
            orgId,
            line.projectId,
            line.budgetLineId,
            year,
            line.donorId, // Extrait du schéma Zod mis à jour
          );

          // --- 3.5 Validation Budgétaire et Multi-Bailleur ---
          if (line.projectId && line.debit > 0) {
            const budgetStatus = await BudgetService.getAvailableBudget(
              orgId,
              line.projectId,
              line.budgetLineId || "GENERIC",
              year,
              line.donorId,
            );

            if (budgetStatus) {
              // 1. Vérification de la Ligne Budgétaire (Le "Chapeau" budgétaire)
              // Ici, ton type indique que c'est encore '.available'
              if (
                line.budgetLineId &&
                line.debit > budgetStatus.budgetLine.available
              ) {
                return toLambdaResponse(
                  badRequest({
                    code: "ERROR_BUDGET_LINE_EXCEEDED",
                    message: `Dépassement de ligne budgétaire ${line.budgetLineId}. (Disponible: ${budgetStatus.budgetLine.available.toLocaleString()} XOF)`,
                  }),
                );
              }

              // 2. Vérification du Cash Réel du Bailleur (La Trésorerie)
              // Ici, ton type pour le donor utilise probablement 'cashAvailable'
              if (line.donorId && budgetStatus.donor) {
                if (line.debit > budgetStatus.donor.cashAvailable) {
                  return toLambdaResponse(
                    badRequest({
                      code: "ERROR_DONOR_CASH_EXCEEDED",
                      message: `Fonds insuffisants en banque pour le bailleur ${line.donorId}. (Disponible: ${budgetStatus.donor.cashAvailable.toLocaleString()} XOF)`,
                    }),
                  );
                }
              }
            }
          }
        }
      }

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
