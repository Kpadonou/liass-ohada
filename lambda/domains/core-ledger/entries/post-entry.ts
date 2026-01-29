import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import {
  DynamoDBClient,
  TransactWriteItemsCommand,
  GetItemCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall } from "@aws-sdk/util-dynamodb";
import { EntrySchema } from "@/models/core-ledger/entry";
import { EntryLineSchema } from "@/models/core-ledger/entry-line";
import { FiscalYearSchema } from "@/models/core-ledger/fiscal-year";
import { KeyFactory } from "../../../shared/key-builder";
import { I18nResolver } from "../../../shared/i18n";
import {
  badRequest,
  created,
  toLambdaResponse,
} from "@/models/shared/api-response";

const dynamoClient = new DynamoDBClient({});

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    const body = JSON.parse(event.body || "{}");
    const orgId = event.requestContext.authorizer?.claims?.orgId || "test-org";
    const year = parseInt(body.year);
    const entryId = body.entryId || `ENT-${Date.now()}`;

    // Check FiscalYear status
    const fyPk = KeyFactory.orgKey(orgId);
    const fySk = `FY#${year}`;
    const fyResult = await dynamoClient.send(
      new GetItemCommand({
        TableName: process.env.TABLE_NAME!,
        Key: { pk: { S: fyPk }, sk: { S: fySk } },
      })
    );
    if (!fyResult.Item) {
      const i18n = new I18nResolver(event.headers["Accept-Language"]);
      return toLambdaResponse(
        badRequest(i18n.getMessage("ERROR_FISCAL_YEAR_NOT_FOUND"))
      );
    }
    const fiscalYear = FiscalYearSchema.parse(fyResult.Item);
    if (fiscalYear.status === "LOCKED" || fiscalYear.status === "CLOSED") {
      const i18n = new I18nResolver(event.headers["Accept-Language"]);
      return toLambdaResponse(
        badRequest(i18n.getMessage("ERROR_FISCAL_YEAR_LOCKED"))
      );
    }

    const lines = body.lines || [];
    let totalDebit = 0;
    let totalCredit = 0;

    const transactItems = [];

    // Entry
    const entryData = {
      ...body,
      orgId,
      year,
      entryId,
      status: "POSTED",
      entityType: "ENTRY",
      pk: KeyFactory.partitionKey(orgId, year),
      sk: KeyFactory.entrySK(entryId),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    for (const line of lines) {
      totalDebit += line.debit || 0;
      totalCredit += line.credit || 0;

      const lineId = `LINE-${Date.now()}-${Math.random()}`;
      const lineData = {
        ...line,
        orgId,
        year,
        lineId,
        entryId,
        entityType: "ENTRY_LINE",
        pk: KeyFactory.partitionKey(orgId, year),
        sk: KeyFactory.entryLineSK(lineId),
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
          TableName: process.env.TABLE_NAME!,
          Item: marshall(lineValidation.data),
        },
      });
    }

    // Double-entry check
    if (totalDebit !== totalCredit) {
      const i18n = new I18nResolver(event.headers["Accept-Language"]);
      return toLambdaResponse(
        badRequest(i18n.getMessage("ERROR_UNBALANCED_ENTRY"))
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
        TableName: process.env.TABLE_NAME!,
        Item: marshall(entryValidation.data),
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
