/**
 * @description Slim handler to consult the Journal (Livre-Journal).
 * Uses GSI5 for high-performance chronological retrieval of Entry Headers.
 */
import { config } from "@/lambda/shared/config";
import { dynamoClient } from "@/lambda/shared/dynamo-client";
import { KeyFactory } from "@/lambda/shared/key-builder";
import { createHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { QueryCommand } from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { z } from "zod";

const ConsultationSchema = z.object({
  year: z.string().regex(/^\d{4}$/),
  journalCode: z.string().optional(),
  month: z
    .string()
    .regex(/^\d{2}$/)
    .optional(),
});

export const handler = createHandler(
  ConsultationSchema,
  async (data, { orgId, i18n }) => {
    const { year, journalCode, month } = data;

    // La PK est TOUJOURS la même pour l'année (Livre-Journal complet)
    const pk = KeyFactory.gsi5JournalPK(orgId, year);

    // On construit la SK de manière hiérarchique
    let skFilter = "";
    if (journalCode) {
      skFilter = `JNL#${journalCode.toUpperCase()}`;
      if (month) {
        skFilter += `#DT#${year}-${month}`;
      }
    }

    const queryParams: any = {
      TableName: config.TABLE_NAME,
      IndexName: "GSI5",
      KeyConditionExpression: "#pk = :pk",
      ExpressionAttributeNames: { "#pk": "GSI5PK" },
      ExpressionAttributeValues: marshall({ ":pk": pk }),
      ScanIndexForward: true,
    };

    // Si on a un filtre (Journal ou Journal+Mois), on l'ajoute
    if (skFilter) {
      queryParams.KeyConditionExpression += " AND begins_with(#sk, :sk)";
      queryParams.ExpressionAttributeNames["#sk"] = "GSI5SK";
      queryParams.ExpressionAttributeValues[":sk"] = skFilter;
    }

    const result = await dynamoClient.send(new QueryCommand(queryParams));

    const entries = (result.Items || []).map((item) => {
      const entry = unmarshall(item);
      return {
        entryId: entry.entryId,
        date: entry.entryDate,
        label: entry.label,
        journal: entry.journalCode,
        reference: entry.voucherNumber,
        amount: entry.totalDebit, // Total Debit = Total Credit in double-entry
        status: entry.status,
      };
    });

    return {
      message: i18n.getMessage("SUCCESS_JOURNAL_RETRIEVED"),
      data: {
        meta: {
          year,
          journalCode: journalCode || "ALL",
          month: month || "ALL",
        },
        entries,
      },
    };
  },
);
