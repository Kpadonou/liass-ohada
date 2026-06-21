import { config } from "@/lambda/shared/config";
import { dynamoClient } from "@/lambda/shared/dynamo-client";
import { KeyFactory } from "@/lambda/shared/key-builder";
import { AppError } from "@/lambda/shared/app-error";
import {
  GetItemCommand,
  QueryCommand,
  TransactWriteItemsCommand,
  UpdateItemCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import {
  CreateThirdPartyRequest,
  ThirdPartyDto,
  ThirdPartyDtoSchema,
  ThirdPartyStatusValue,
  ThirdPartyTypeValue,
  UpdateThirdPartyRequest,
} from "@liass-ohada/shared/accounting";
import { randomUUID } from "crypto";

interface ThirdPartyItem extends ThirdPartyDto {
  orgId: string;
  entityType: "THIRD_PARTY";
  PK: string;
  SK: string;
}

/**
 * @description Enhanced Subsidiary Ledger with Lettering support.
 * Fetches the Subsidiary Ledger (history) for a specific third-party account.
 */
export class ThirdPartyService {
  static async create(
    orgId: string,
    input: CreateThirdPartyRequest,
  ): Promise<ThirdPartyDto> {
    const now = new Date().toISOString();
    const thirdPartyId = `TP-${randomUUID()}`;
    const item: ThirdPartyItem = {
      ...input,
      code: ThirdPartyService.normalizeCode(input.code),
      thirdPartyId,
      status: "ACTIVE",
      orgId,
      entityType: "THIRD_PARTY",
      PK: KeyFactory.orgKey(orgId),
      SK: KeyFactory.thirdPartySK(input.type, thirdPartyId),
      createdAt: now,
      updatedAt: now,
    };

    try {
      await dynamoClient.send(
        new TransactWriteItemsCommand({
          TransactItems: [
            {
              Put: {
                TableName: config.TABLE_NAME,
                Item: marshall(item, { removeUndefinedValues: true }),
                ConditionExpression:
                  "attribute_not_exists(PK) AND attribute_not_exists(SK)",
              },
            },
            {
              Put: {
                TableName: config.TABLE_NAME,
                Item: marshall({
                  PK: KeyFactory.orgKey(orgId),
                  SK: KeyFactory.thirdPartyCodeSK(item.code),
                  entityType: "THIRD_PARTY_CODE_UNIQUE",
                  thirdPartyId,
                  thirdPartyType: item.type,
                  createdAt: now,
                }),
                ConditionExpression:
                  "attribute_not_exists(PK) AND attribute_not_exists(SK)",
              },
            },
          ],
        }),
      );
    } catch (error: any) {
      if (error?.name === "TransactionCanceledException") {
        throw new AppError(409, "THIRD_PARTY_CODE_ALREADY_EXISTS");
      }
      throw error;
    }

    return ThirdPartyService.toDto(item);
  }

  static async get(
    orgId: string,
    type: ThirdPartyTypeValue,
    thirdPartyId: string,
  ): Promise<ThirdPartyDto> {
    return ThirdPartyService.toDto(
      await ThirdPartyService.getItem(orgId, type, thirdPartyId),
    );
  }

  static async list(
    orgId: string,
    options: {
      type: ThirdPartyTypeValue;
      status?: ThirdPartyStatusValue;
      limit?: number;
      cursor?: string;
    },
  ): Promise<{
    items: ThirdPartyDto[];
    nextCursor?: string;
    hasMore: boolean;
  }> {
    const exclusiveStartKey = ThirdPartyService.decodeCursor(options.cursor);
    if (exclusiveStartKey) {
      let cursorKey: Record<string, unknown>;
      try {
        cursorKey = unmarshall(exclusiveStartKey as any);
      } catch {
        throw new AppError(400, "ERROR_INVALID_CURSOR");
      }
      if (
        cursorKey.PK !== KeyFactory.orgKey(orgId) ||
        typeof cursorKey.SK !== "string" ||
        !cursorKey.SK.startsWith(KeyFactory.thirdPartyPrefix(options.type))
      ) {
        throw new AppError(400, "ERROR_INVALID_CURSOR");
      }
    }
    const result = await dynamoClient.send(
      new QueryCommand({
        TableName: config.TABLE_NAME,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :prefix)",
        ExpressionAttributeValues: marshall({
          ":pk": KeyFactory.orgKey(orgId),
          ":prefix": KeyFactory.thirdPartyPrefix(options.type),
          ...(options.status ? { ":status": options.status } : {}),
        }),
        ...(options.status
          ? {
              ExpressionAttributeNames: { "#status": "status" },
              FilterExpression: "#status = :status",
            }
          : {}),
        Limit: options.limit ?? 100,
        ExclusiveStartKey: exclusiveStartKey,
        ScanIndexForward: true,
      }),
    );
    const items = (result.Items ?? []).map((item) =>
      ThirdPartyService.toDto(unmarshall(item) as ThirdPartyItem),
    );
    const nextCursor = result.LastEvaluatedKey
      ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString("base64")
      : undefined;

    return { items, nextCursor, hasMore: !!nextCursor };
  }

  static async update(
    orgId: string,
    type: ThirdPartyTypeValue,
    thirdPartyId: string,
    updates: UpdateThirdPartyRequest,
  ): Promise<ThirdPartyDto> {
    return ThirdPartyService.updateFields(orgId, type, thirdPartyId, updates);
  }

  static async activate(
    orgId: string,
    type: ThirdPartyTypeValue,
    thirdPartyId: string,
  ): Promise<ThirdPartyDto> {
    return ThirdPartyService.updateFields(orgId, type, thirdPartyId, {
      status: "ACTIVE",
    } as UpdateThirdPartyRequest & { status: ThirdPartyStatusValue });
  }

  static async deactivate(
    orgId: string,
    type: ThirdPartyTypeValue,
    thirdPartyId: string,
  ): Promise<ThirdPartyDto> {
    return ThirdPartyService.updateFields(orgId, type, thirdPartyId, {
      status: "INACTIVE",
    } as UpdateThirdPartyRequest & { status: ThirdPartyStatusValue });
  }

  static async getItem(
    orgId: string,
    type: ThirdPartyTypeValue,
    thirdPartyId: string,
  ): Promise<ThirdPartyItem> {
    const result = await dynamoClient.send(
      new GetItemCommand({
        TableName: config.TABLE_NAME,
        Key: marshall({
          PK: KeyFactory.orgKey(orgId),
          SK: KeyFactory.thirdPartySK(type, thirdPartyId),
        }),
      }),
    );
    if (!result.Item) {
      throw new AppError(404, "THIRD_PARTY_NOT_FOUND");
    }
    const item = unmarshall(result.Item) as ThirdPartyItem;
    if (
      item.orgId !== orgId ||
      item.type !== type ||
      item.entityType !== "THIRD_PARTY"
    ) {
      throw new AppError(404, "THIRD_PARTY_NOT_FOUND");
    }
    return item;
  }

  static async getLedger(
    orgId: string,
    params: {
      accountId: string;
      thirdPartyId: string;
      startDate?: string;
      endDate?: string;
    },
  ) {
    const { accountId, thirdPartyId, startDate, endDate } = params;
    const normalizedAccountId = accountId.padEnd(8, "0");

    let keyCondition = "GSI2PK = :pk";
    const expressionValues: any = {
      ":pk": KeyFactory.gsi2PK(orgId, normalizedAccountId, thirdPartyId),
    };

    if (startDate && endDate) {
      keyCondition += " AND GSI2SK BETWEEN :start AND :end";
      expressionValues[":start"] = KeyFactory.gsi2SK(startDate, "");
      expressionValues[":end"] = KeyFactory.gsi2SK(endDate, "\uffff");
    }

    const result = await dynamoClient.send(
      new QueryCommand({
        TableName: config.TABLE_NAME,
        IndexName: config.GSI2,
        KeyConditionExpression: keyCondition,
        ExpressionAttributeValues: marshall(expressionValues),
        ScanIndexForward: true, // Chronological order
      }),
    );

    const lines = (result.Items || []).map((item) => {
      const line = unmarshall(item);
      return {
        date: line.entryDate,
        label: line.label,
        reference: line.voucherNumber,
        debit: Number(line.debit) || 0,
        credit: Number(line.credit) || 0,
        // The famous lettering code for reconciliation
        letteringCode: line.letteringCode || null,
        entryId: line.entryId,
        lineId: line.lineId,
      };
    });

    const summary = lines.reduce(
      (acc, line) => {
        acc.totalDebit += line.debit;
        acc.totalCredit += line.credit;
        return acc;
      },
      { totalDebit: 0, totalCredit: 0 },
    );

    return {
      accountId: normalizedAccountId,
      thirdPartyId,
      period: { startDate, endDate },
      summary: {
        ...summary,
        balance: summary.totalDebit - summary.totalCredit,
      },
      count: lines.length,
      lines,
    };
  }

  private static async updateFields(
    orgId: string,
    type: ThirdPartyTypeValue,
    thirdPartyId: string,
    updates: UpdateThirdPartyRequest & { status?: ThirdPartyStatusValue },
  ): Promise<ThirdPartyDto> {
    const entries = Object.entries(updates).filter(
      ([, value]) => value !== undefined,
    );
    const names: Record<string, string> = {};
    const values: Record<string, unknown> = {
      ":updatedAt": new Date().toISOString(),
      ":entityType": "THIRD_PARTY",
    };
    const setters = ["updatedAt = :updatedAt"];
    for (const [field, value] of entries) {
      names[`#${field}`] = field;
      values[`:${field}`] = value;
      setters.push(`#${field} = :${field}`);
    }

    try {
      const result = await dynamoClient.send(
        new UpdateItemCommand({
          TableName: config.TABLE_NAME,
          Key: marshall({
            PK: KeyFactory.orgKey(orgId),
            SK: KeyFactory.thirdPartySK(type, thirdPartyId),
          }),
          ConditionExpression:
            "attribute_exists(PK) AND attribute_exists(SK) AND entityType = :entityType",
          UpdateExpression: `SET ${setters.join(", ")}`,
          ...(Object.keys(names).length
            ? { ExpressionAttributeNames: names }
            : {}),
          ExpressionAttributeValues: marshall(values, {
            removeUndefinedValues: true,
          }),
          ReturnValues: "ALL_NEW",
        }),
      );
      return ThirdPartyService.toDto(
        unmarshall(result.Attributes ?? {}) as ThirdPartyItem,
      );
    } catch (error: any) {
      if (error?.name === "ConditionalCheckFailedException") {
        throw new AppError(404, "THIRD_PARTY_NOT_FOUND");
      }
      throw error;
    }
  }

  private static toDto(item: ThirdPartyItem): ThirdPartyDto {
    return ThirdPartyDtoSchema.parse({
      thirdPartyId: item.thirdPartyId,
      code: item.code,
      displayName: item.displayName,
      type: item.type,
      status: item.status,
      email: item.email,
      phone: item.phone,
      address: item.address,
      country: item.country,
      taxIdentifier: item.taxIdentifier,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    });
  }

  private static normalizeCode(code: string): string {
    return code.trim().toUpperCase();
  }

  private static decodeCursor(
    cursor?: string,
  ): Record<string, any> | undefined {
    if (!cursor) return undefined;
    try {
      return JSON.parse(Buffer.from(cursor, "base64").toString());
    } catch {
      throw new AppError(400, "ERROR_INVALID_CURSOR");
    }
  }
}
