import { config } from "@/lambda/shared/config";
import { dynamoClient } from "@/lambda/shared/dynamo-client";
import { KeyFactory } from "@/lambda/shared/key-builder";
import { AppError } from "@/lambda/shared/app-error";
import { resolveAuxiliaryMetadata } from "@/lambda/shared/account-auxiliary";
import {
  BatchGetItemCommand,
  GetItemCommand,
  QueryCommand,
  TransactWriteItemsCommand,
  UpdateItemCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import {
  Account,
  AccountDtoSchema,
  CreateThirdPartyRequest,
  CreateThirdPartyRequestSchema,
  FiscalYearSchema,
  ThirdPartyLedgerDto,
  ThirdPartyLedgerDtoSchema,
  ThirdPartyLedgerQuery,
  ThirdPartyDto,
  ThirdPartyDtoSchema,
  ThirdPartyStatusValue,
  ThirdPartyTypeValue,
  UpdateThirdPartyRequest,
  UpdateThirdPartyRequestSchema,
} from "@liass-ohada/shared/accounting";
import { randomUUID } from "crypto";

interface ThirdPartyItem extends ThirdPartyDto {
  orgId: string;
  entityType: "THIRD_PARTY";
  PK: string;
  SK: string;
}

interface ThirdPartyCodeLockItem {
  PK: string;
  SK: string;
  entityType: "THIRD_PARTY_CODE_UNIQUE";
  thirdPartyId: string;
  thirdPartyType: ThirdPartyTypeValue;
  createdAt: string;
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
    const validatedInput = CreateThirdPartyRequestSchema.parse(input);
    const now = new Date().toISOString();
    const thirdPartyId = `TP-${randomUUID()}`;
    const item: ThirdPartyItem = {
      ...validatedInput,
      code: ThirdPartyService.normalizeCode(validatedInput.code),
      thirdPartyId,
      status: "ACTIVE",
      orgId,
      entityType: "THIRD_PARTY",
      PK: KeyFactory.orgKey(orgId),
      SK: KeyFactory.thirdPartySK(validatedInput.type, thirdPartyId),
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
      codePrefix?: string;
      limit?: number;
      cursor?: string;
    },
  ): Promise<{
    items: ThirdPartyDto[];
    nextCursor?: string;
    hasMore: boolean;
  }> {
    if (options.codePrefix) {
      return ThirdPartyService.listByCodePrefix(orgId, options);
    }

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

  private static async listByCodePrefix(
    orgId: string,
    options: {
      type: ThirdPartyTypeValue;
      status?: ThirdPartyStatusValue;
      codePrefix?: string;
      limit?: number;
      cursor?: string;
    },
  ): Promise<{
    items: ThirdPartyDto[];
    nextCursor?: string;
    hasMore: boolean;
  }> {
    const normalizedCodePrefix = ThirdPartyService.normalizeCode(
      options.codePrefix ?? "",
    );
    if (!normalizedCodePrefix) {
      throw new AppError(400, "ERROR_INVALID_INPUT");
    }

    const lockPrefix = KeyFactory.thirdPartyCodeSK(normalizedCodePrefix);
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
        !cursorKey.SK.startsWith(lockPrefix)
      ) {
        throw new AppError(400, "ERROR_INVALID_CURSOR");
      }
    }

    const lockResult = await dynamoClient.send(
      new QueryCommand({
        TableName: config.TABLE_NAME,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :prefix)",
        ExpressionAttributeValues: marshall({
          ":pk": KeyFactory.orgKey(orgId),
          ":prefix": lockPrefix,
        }),
        Limit: options.limit ?? 100,
        ExclusiveStartKey: exclusiveStartKey,
        ScanIndexForward: true,
      }),
    );
    const locks = (lockResult.Items ?? [])
      .map((item) => unmarshall(item) as ThirdPartyCodeLockItem)
      .filter(
        (item) =>
          item.entityType === "THIRD_PARTY_CODE_UNIQUE" &&
          item.thirdPartyType === options.type,
      );

    const masterItems = await ThirdPartyService.batchGetThirdPartyItems(
      orgId,
      locks,
    );
    const items = masterItems
      .filter((item) => !options.status || item.status === options.status)
      .map((item) => ThirdPartyService.toDto(item));
    const nextCursor = lockResult.LastEvaluatedKey
      ? Buffer.from(JSON.stringify(lockResult.LastEvaluatedKey)).toString(
          "base64",
        )
      : undefined;

    return { items, nextCursor, hasMore: !!nextCursor };
  }

  private static async batchGetThirdPartyItems(
    orgId: string,
    locks: ThirdPartyCodeLockItem[],
  ): Promise<ThirdPartyItem[]> {
    if (locks.length === 0) {
      return [];
    }

    const keys = locks.map((lock) => ({
      PK: KeyFactory.orgKey(orgId),
      SK: KeyFactory.thirdPartySK(lock.thirdPartyType, lock.thirdPartyId),
    }));
    const itemsByKey = new Map<string, ThirdPartyItem>();

    for (let index = 0; index < keys.length; index += 100) {
      const chunk = keys.slice(index, index + 100);
      const result = await dynamoClient.send(
        new BatchGetItemCommand({
          RequestItems: {
            [config.TABLE_NAME]: {
              Keys: chunk.map((key) => marshall(key)),
            },
          },
        }),
      );

      for (const rawItem of result.Responses?.[config.TABLE_NAME] ?? []) {
        const item = unmarshall(rawItem) as ThirdPartyItem;
        if (
          item.orgId === orgId &&
          item.entityType === "THIRD_PARTY" &&
          item.PK === KeyFactory.orgKey(orgId) &&
          item.SK === KeyFactory.thirdPartySK(item.type, item.thirdPartyId)
        ) {
          itemsByKey.set(`${item.type}:${item.thirdPartyId}`, item);
        }
      }
    }

    return locks
      .map((lock) =>
        itemsByKey.get(`${lock.thirdPartyType}:${lock.thirdPartyId}`),
      )
      .filter((item): item is ThirdPartyItem => !!item);
  }

  static async update(
    orgId: string,
    type: ThirdPartyTypeValue,
    thirdPartyId: string,
    updates: UpdateThirdPartyRequest,
  ): Promise<ThirdPartyDto> {
    return ThirdPartyService.updateFields(
      orgId,
      type,
      thirdPartyId,
      UpdateThirdPartyRequestSchema.parse(updates),
    );
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
    params: ThirdPartyLedgerQuery,
  ): Promise<ThirdPartyLedgerDto> {
    const normalizedAccountId = params.accountId.padEnd(8, "0");
    const fiscalYear = await ThirdPartyService.getFiscalYear(
      orgId,
      params.fiscalYear,
    );
    const startDate = params.startDate ?? fiscalYear.startDate;
    const endDate = params.endDate ?? fiscalYear.endDate;

    if (startDate < fiscalYear.startDate || endDate > fiscalYear.endDate) {
      throw new AppError(400, "ERROR_TRIAL_BALANCE_DATE_OUTSIDE_FISCAL_YEAR");
    }

    const { account, thirdParty } =
      await ThirdPartyService.validateAuxiliaryLedgerScope(orgId, {
        accountId: normalizedAccountId,
        thirdPartyId: params.thirdPartyId,
        thirdPartyType: params.thirdPartyType,
      });
    const gsi2pk = KeyFactory.gsi2PK(
      orgId,
      normalizedAccountId,
      thirdParty.thirdPartyId,
    );
    const rangeStart = KeyFactory.gsi2SK(startDate, "");
    const rangeEnd = KeyFactory.gsi2SK(endDate, "\uffff");
    const continuation = ThirdPartyService.decodeLedgerCursor(
      params.cursor,
      gsi2pk,
      rangeStart,
      rangeEnd,
    );
    const openingBalance =
      await ThirdPartyService.getAuxiliaryOpeningBalance({
        orgId,
        gsi2pk,
        accountId: account.accountId,
        thirdPartyId: thirdParty.thirdPartyId,
        fiscalYearStartDate: fiscalYear.startDate,
        startDate,
      });
    const movementTotals = await ThirdPartyService.getAuxiliaryMovementTotals({
      orgId,
      gsi2pk,
      accountId: account.accountId,
      thirdPartyId: thirdParty.thirdPartyId,
      rangeStart,
      rangeEnd,
    });
    let exclusiveStartKey = continuation?.key;
    let runningBalance = continuation?.runningBalance ?? openingBalance.balance;
    let lastEvaluatedKey: Record<string, any> | undefined;
    const movements: ThirdPartyLedgerDto["movements"] = [];
    const limit = params.limit ?? 50;

    do {
      const result = await dynamoClient.send(
        new QueryCommand({
          TableName: config.TABLE_NAME,
          IndexName: config.GSI2,
          KeyConditionExpression: "GSI2PK = :pk AND GSI2SK BETWEEN :start AND :end",
          ExpressionAttributeValues: marshall({
            ":pk": gsi2pk,
            ":start": rangeStart,
            ":end": rangeEnd,
          }),
          Limit: Math.max(limit - movements.length, 1),
          ExclusiveStartKey: exclusiveStartKey,
          ScanIndexForward: true,
        }),
      );

      for (const item of result.Items ?? []) {
        const line = unmarshall(item);
        if (
          !ThirdPartyService.isAuxiliaryLedgerLine(line, {
            orgId,
            accountId: account.accountId,
            thirdPartyId: thirdParty.thirdPartyId,
            gsi2pk,
          }) ||
          line.journalCode === "RAN"
        ) {
          continue;
        }

        const debit = Number(line.debit) || 0;
        const credit = Number(line.credit) || 0;
        runningBalance += debit - credit;
        movements.push({
          date: line.entryDate,
          label: line.label || line.description,
          reference: line.voucherNumber || line.entryId,
          journalCode: line.journalCode,
          journal: line.journalCode,
          debit,
          credit,
          runningBalance,
          letteringCode: line.letteringCode ?? null,
          letteringStatus: line.letteringStatus,
          letteredAmount: line.letteredAmount,
          remainingAmount: line.remainingAmount,
          entryId: line.entryId,
          lineId: line.lineId,
        });
      }

      lastEvaluatedKey = result.LastEvaluatedKey;
      exclusiveStartKey = lastEvaluatedKey;
    } while (movements.length < limit && lastEvaluatedKey);

    const nextCursor = lastEvaluatedKey
      ? ThirdPartyService.encodeLedgerCursor({
          key: lastEvaluatedKey,
          runningBalance,
        })
      : undefined;

    return ThirdPartyLedgerDtoSchema.parse({
      accountId: account.accountId,
      thirdPartyId: thirdParty.thirdPartyId,
      thirdPartyType: thirdParty.type,
      account: ThirdPartyService.toAccountDto(account),
      thirdParty: ThirdPartyService.toDto(thirdParty),
      period: {
        fiscalYear: String(fiscalYear.year),
        startDate,
        endDate,
      },
      openingBalance,
      movements,
      lines: movements,
      summary: {
        totalDebit: movementTotals.totalDebit,
        totalCredit: movementTotals.totalCredit,
        balance: movementTotals.totalDebit - movementTotals.totalCredit,
      },
      count: movementTotals.count,
      finalBalance:
        openingBalance.balance +
        movementTotals.totalDebit -
        movementTotals.totalCredit,
      nextCursor,
      hasMore: !!nextCursor,
    });
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

  private static toAccountDto(account: Account) {
    const metadata = resolveAuxiliaryMetadata(account);
    return AccountDtoSchema.parse({
      orgId: account.orgId,
      accountId: account.accountId,
      accountName: account.accountName,
      accountNature: account.accountNature,
      accountUsage: account.accountUsage,
      isThirdPartyAccount: account.isThirdPartyAccount,
      ...metadata,
      classCode: account.classCode,
      financialStatementCode: account.financialStatementCode,
      allowReconciliation: account.allowReconciliation,
      isActive: account.isActive,
      createdAt: account.createdAt,
      updatedAt: account.updatedAt,
    });
  }

  private static async getFiscalYear(orgId: string, year: string | number) {
    const result = await dynamoClient.send(
      new GetItemCommand({
        TableName: config.TABLE_NAME,
        Key: marshall({
          PK: KeyFactory.orgKey(orgId),
          SK: KeyFactory.fiscalYearSK(year),
        }),
      }),
    );

    if (!result.Item) {
      throw new AppError(404, "ERROR_FISCAL_YEAR_NOT_FOUND");
    }

    return FiscalYearSchema.parse(unmarshall(result.Item));
  }

  private static async validateAuxiliaryLedgerScope(
    orgId: string,
    params: {
      accountId: string;
      thirdPartyId: string;
      thirdPartyType: ThirdPartyTypeValue;
    },
  ): Promise<{ account: Account; thirdParty: ThirdPartyItem }> {
    const accountResult = await dynamoClient.send(
      new GetItemCommand({
        TableName: config.TABLE_NAME,
        Key: marshall({
          PK: KeyFactory.orgKey(orgId),
          SK: KeyFactory.accountSK(params.accountId),
        }),
      }),
    );

    if (!accountResult.Item) {
      throw new AppError(404, "ERROR_ACCOUNT_NOT_FOUND");
    }

    const account = unmarshall(accountResult.Item) as Account;
    if (
      account.orgId !== orgId ||
      account.entityType !== "ACCOUNT" ||
      account.accountId !== params.accountId
    ) {
      throw new AppError(404, "ERROR_ACCOUNT_NOT_FOUND");
    }

    if (account.isActive === false) {
      throw new AppError(400, "ERROR_ACCOUNT_INACTIVE");
    }

    const metadata = resolveAuxiliaryMetadata(account);
    if (!metadata.requiresThirdParty || metadata.auxiliaryType === "NONE") {
      throw new AppError(400, "THIRD_PARTY_NOT_ALLOWED");
    }

    if (
      metadata.auxiliaryType !== "THIRD_PARTY" &&
      metadata.auxiliaryType !== params.thirdPartyType
    ) {
      throw new AppError(400, "THIRD_PARTY_TYPE_MISMATCH");
    }

    const thirdParty = await ThirdPartyService.getItem(
      orgId,
      params.thirdPartyType,
      params.thirdPartyId,
    );

    if (thirdParty.status !== "ACTIVE") {
      throw new AppError(400, "THIRD_PARTY_INACTIVE");
    }

    return { account, thirdParty };
  }

  private static async getAuxiliaryOpeningBalance(params: {
    orgId: string;
    gsi2pk: string;
    accountId: string;
    thirdPartyId: string;
    fiscalYearStartDate: string;
    startDate: string;
  }) {
    const rangeStart = KeyFactory.gsi2SK(params.fiscalYearStartDate, "");
    const rangeEnd = KeyFactory.gsi2SK(params.startDate, "\uffff");
    let lastEvaluatedKey: Record<string, any> | undefined;
    let debit = 0;
    let credit = 0;

    do {
      const result = await dynamoClient.send(
        new QueryCommand({
          TableName: config.TABLE_NAME,
          IndexName: config.GSI2,
          KeyConditionExpression: "GSI2PK = :pk AND GSI2SK BETWEEN :start AND :end",
          ExpressionAttributeValues: marshall({
            ":pk": params.gsi2pk,
            ":start": rangeStart,
            ":end": rangeEnd,
          }),
          ExclusiveStartKey: lastEvaluatedKey,
          ScanIndexForward: true,
        }),
      );

      for (const item of result.Items ?? []) {
        const line = unmarshall(item);
        if (
          ThirdPartyService.isAuxiliaryLedgerLine(line, params) &&
          (line.entryDate < params.startDate || line.journalCode === "RAN")
        ) {
          debit += Number(line.debit) || 0;
          credit += Number(line.credit) || 0;
        }
      }

      lastEvaluatedKey = result.LastEvaluatedKey;
    } while (lastEvaluatedKey);

    return { debit, credit, balance: debit - credit };
  }

  private static async getAuxiliaryMovementTotals(params: {
    orgId: string;
    gsi2pk: string;
    accountId: string;
    thirdPartyId: string;
    rangeStart: string;
    rangeEnd: string;
  }): Promise<{ totalDebit: number; totalCredit: number; count: number }> {
    let lastEvaluatedKey: Record<string, any> | undefined;
    let totalDebit = 0;
    let totalCredit = 0;
    let count = 0;

    do {
      const result = await dynamoClient.send(
        new QueryCommand({
          TableName: config.TABLE_NAME,
          IndexName: config.GSI2,
          KeyConditionExpression: "GSI2PK = :pk AND GSI2SK BETWEEN :start AND :end",
          ExpressionAttributeValues: marshall({
            ":pk": params.gsi2pk,
            ":start": params.rangeStart,
            ":end": params.rangeEnd,
          }),
          ExclusiveStartKey: lastEvaluatedKey,
          ScanIndexForward: true,
        }),
      );

      for (const item of result.Items ?? []) {
        const line = unmarshall(item);
        if (
          ThirdPartyService.isAuxiliaryLedgerLine(line, params) &&
          line.journalCode !== "RAN"
        ) {
          totalDebit += Number(line.debit) || 0;
          totalCredit += Number(line.credit) || 0;
          count += 1;
        }
      }

      lastEvaluatedKey = result.LastEvaluatedKey;
    } while (lastEvaluatedKey);

    return { totalDebit, totalCredit, count };
  }

  private static isAuxiliaryLedgerLine(
    line: Record<string, any>,
    params: {
      orgId: string;
      accountId: string;
      thirdPartyId: string;
      gsi2pk: string;
    },
  ): boolean {
    return (
      line.orgId === params.orgId &&
      line.entityType === "ENTRY_LINE" &&
      line.accountId === params.accountId &&
      line.thirdPartyId === params.thirdPartyId &&
      line.GSI2PK === params.gsi2pk
    );
  }

  private static decodeLedgerCursor(
    cursor: string | undefined,
    expectedGsi2pk: string,
    rangeStart: string,
    rangeEnd: string,
  ):
    | {
        key: Record<string, any>;
        runningBalance: number;
      }
    | undefined {
    if (!cursor) {
      return undefined;
    }

    try {
      const parsed = JSON.parse(Buffer.from(cursor, "base64").toString());
      const gsi2pk = ThirdPartyService.readAttributeString(parsed.key?.GSI2PK);
      const gsi2sk = ThirdPartyService.readAttributeString(parsed.key?.GSI2SK);
      if (
        !parsed ||
        typeof parsed !== "object" ||
        !parsed.key ||
        typeof parsed.key !== "object" ||
        typeof parsed.runningBalance !== "number" ||
        !Number.isInteger(parsed.runningBalance) ||
        gsi2pk !== expectedGsi2pk ||
        !gsi2sk ||
        gsi2sk < rangeStart ||
        gsi2sk > rangeEnd
      ) {
        throw new Error("Invalid cursor");
      }

      return {
        key: parsed.key,
        runningBalance: parsed.runningBalance,
      };
    } catch {
      throw new AppError(400, "ERROR_INVALID_CURSOR");
    }
  }

  private static encodeLedgerCursor(cursor: {
    key: Record<string, any>;
    runningBalance: number;
  }): string {
    return Buffer.from(JSON.stringify(cursor)).toString("base64");
  }

  private static readAttributeString(attribute: any): string | undefined {
    if (typeof attribute === "string") {
      return attribute;
    }
    if (attribute && typeof attribute.S === "string") {
      return attribute.S;
    }
    return undefined;
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
