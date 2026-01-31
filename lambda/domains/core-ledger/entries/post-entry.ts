import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import {
  TransactWriteItemsCommand,
  GetItemCommand,
  QueryCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { EntrySchema } from "../../../../models/core-ledger/entry";
import { EntryLineSchema } from "../../../../models/core-ledger/entry-line";
import { FiscalYearSchema } from "../../../../models/core-ledger/fiscal-year";
import { KeyFactory } from "../../../shared/key-builder";
import { I18nResolver } from "../../../shared/i18n";
import {
  badRequest,
  created,
  toLambdaResponse,
} from "../../../../models/shared/api-response";
import { dynamoClient } from "../../../shared/dynamo-client";
import { config } from "../../../shared/config";

const formatAccount = (acc: string) => acc.padStart(8, "0");

const isBalanceSheetAccount = (accountId: string): boolean => {
  const classCode = parseInt(accountId.charAt(0), 10);
  return classCode >= 1 && classCode <= 5;
};

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  const i18n = new I18nResolver(event.headers["Accept-Language"]);

  try {
    const body = JSON.parse(event.body || "{}");
    const orgId =
      event.requestContext.authorizer?.claims?.orgId || "test-org-001";
    const userId =
      event.requestContext.authorizer?.claims?.userId || "user-123";
    const year = parseInt(body.year);
    const entryType: string = body.entryType || "STANDARD";
    const entryDate = body.entryDate || new Date().toISOString().split("T")[0];
    const journalCode = body.journalCode || "MISC";

    // 1. Validation de l'Exercice Fiscal
    const fyPk = KeyFactory.orgKey(orgId);
    const fySk = `FY#${year}`;
    const fyResult = await dynamoClient.send(
      new GetItemCommand({
        TableName: config.TABLE_NAME,
        Key: { pk: { S: fyPk }, sk: { S: fySk } },
      })
    );

    if (!fyResult.Item) {
      return toLambdaResponse(
        badRequest(i18n.getMessage("ERROR_FISCAL_YEAR_NOT_FOUND"))
      );
    }

    const fiscalYear = FiscalYearSchema.parse(unmarshall(fyResult.Item));
    if (fiscalYear.status === "LOCKED" || fiscalYear.status === "CLOSED") {
      return toLambdaResponse(
        badRequest(i18n.getMessage("ERROR_FISCAL_YEAR_LOCKED"))
      );
    }

    // 2. Gestion de l'ID d'écriture
    let entryId =
      entryType === "OPENING"
        ? `OPEN-${year}`
        : body.entryId || `ENT-${Date.now()}`;

    const lines = body.lines || [];
    let totalDebit = 0;
    let totalCredit = 0;
    const transactItems = [];

    // 3. Boucle sur les lignes
    for (const line of lines) {
      const debit = Math.round(parseFloat(line.debit) || 0);
      const credit = Math.round(parseFloat(line.credit) || 0);
      const lineId = `LINE-${Date.now()}-${Math.random()
        .toString(36)
        .substr(2, 5)}`;
      const paddedAcc = formatAccount(line.accountId);

      const lineData = {
        orgId,
        year,
        lineId,
        entryId,
        accountId: line.accountId,
        debit,
        credit,
        entryDate,
        journalCode,
        entityType: "ENTRY_LINE" as const,
        pk: KeyFactory.partitionKey(orgId, year),
        sk: KeyFactory.entryLineSK(lineId),
        gsi1sk: `ACC#${paddedAcc}#${entryDate}#${lineId}`,
        gsi2sk: line.thirdPartyId
          ? `TP#${line.thirdPartyId}#${entryDate}`
          : undefined,
        gsi3sk: `JRN#${journalCode}#${entryDate}#${lineId}`,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const lineValidation = EntryLineSchema.safeParse(lineData);
      if (!lineValidation.success) {
        console.error("Zod Error:", lineValidation.error.format());
        return toLambdaResponse(
          badRequest(i18n.getMessage("ERROR_INVALID_INPUT"))
        );
      }

      // FORÇAGE DES INDEX DANS L'OBJET FINAL (Bypass cache Zod)
      const finalItem = { ...lineValidation.data, ...lineData };

      transactItems.push({
        Put: {
          TableName: config.TABLE_NAME,
          Item: marshall(finalItem, { removeUndefinedValues: true }),
        },
      });

      totalDebit += debit;
      totalCredit += credit;
    }

    console.log("⚖️ VÉRIFICATION ÉQUILIBRE:");
    console.log("- Total Débit:", totalDebit);
    console.log("- Total Crédit:", totalCredit);
    console.log("- Sont-ils égaux ?", totalDebit === totalCredit);

    // 4. Équilibre
    if (totalDebit !== totalCredit || totalDebit === 0) {
      return toLambdaResponse(
        badRequest(i18n.getMessage("ERROR_ENTRY_NOT_BALANCED"))
      );
    }

    // 5. Header
    const entryData = {
      orgId,
      year,
      entryId,
      entryType,
      entryDate,
      totalDebit,
      totalCredit,
      status: "POSTED",
      entityType: "ENTRY" as const,
      pk: KeyFactory.partitionKey(orgId, year),
      sk: KeyFactory.entrySK(entryId),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const entryValidation = EntrySchema.safeParse(entryData);
    if (!entryValidation.success) {
      return toLambdaResponse(
        badRequest(i18n.getMessage("ERROR_INVALID_INPUT"))
      );
    }

    transactItems.unshift({
      Put: {
        TableName: config.TABLE_NAME,
        Item: marshall(
          { ...entryValidation.data, ...entryData },
          { removeUndefinedValues: true }
        ),
      },
    });

    await dynamoClient.send(
      new TransactWriteItemsCommand({ TransactItems: transactItems })
    );

    return toLambdaResponse(
      created(entryValidation.data, i18n.getMessage("SUCCESS_ENTRY_POSTED"))
    );
  } catch (error) {
    console.error("PostEntry Error:", error);
    return toLambdaResponse(badRequest(i18n.getMessage("ERROR_INTERNAL")));
  }
};
