import {
  AttributeValue,
  ConditionalCheckFailedException,
  GetItemCommand,
  PutItemCommand,
  QueryCommand,
  UpdateItemCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import type {
  AccountingWork,
  AccountingWorkStatus,
  CabinetDeadline,
  CabinetDeadlineStatus,
} from "@liass-ohada/shared";
import { config, dynamoClient } from "../dynamo-client";
import { KeyFactory } from "../key-builder";

interface CabinetOperationIndexAttributes {
  GSI1PK?: string;
  GSI1SK?: string;
  GSI2PK?: string;
  GSI2SK?: string;
  GSI3PK?: string;
  GSI3SK?: string;
}

export type CabinetWorkRecord = AccountingWork & CabinetOperationIndexAttributes;
export type CabinetDeadlineRecord = CabinetDeadline &
  CabinetOperationIndexAttributes;

export interface Page<T> {
  items: T[];
  nextCursor?: string;
}

interface QueryFilters {
  cursor?: string;
  dueFrom?: string;
  dueTo?: string;
  limit: number;
  priority?: string;
  status?: string;
  type?: string;
  dossierOrgIds?: Set<string>;
  periodStart?: string;
  periodEnd?: string;
  overdue?: boolean;
  today?: string;
}

function encodeCursor(key?: Record<string, AttributeValue>): string | undefined {
  return key
    ? Buffer.from(JSON.stringify(key), "utf8").toString("base64url")
    : undefined;
}

function decodeCursor(cursor?: string): Record<string, AttributeValue> | undefined {
  if (!cursor) return undefined;
  try {
    const value = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    ) as Record<string, AttributeValue>;
    if (!value || typeof value !== "object") {
      throw new Error("Invalid cursor");
    }
    return value;
  } catch {
    throw new Error("Invalid cursor");
  }
}

function toWorkRecord(item?: Record<string, AttributeValue>): CabinetWorkRecord | undefined {
  if (!item) return undefined;
  const value = unmarshall(item);
  return value.entityType === "ACCOUNTING_WORK"
    ? (value as CabinetWorkRecord)
    : undefined;
}

function toDeadlineRecord(
  item?: Record<string, AttributeValue>,
): CabinetDeadlineRecord | undefined {
  if (!item) return undefined;
  const value = unmarshall(item);
  return value.entityType === "CABINET_DEADLINE"
    ? (value as CabinetDeadlineRecord)
    : undefined;
}

function applyCommonFilters<T extends {
  dossierOrgId: string;
  dueDate?: string;
  periodEnd?: string;
  periodStart?: string;
  priority: string;
  status: string;
  type: string;
}>(
  items: T[],
  filters: QueryFilters,
): T[] {
  return items.filter((item) => {
    if (filters.dossierOrgIds && !filters.dossierOrgIds.has(item.dossierOrgId)) {
      return false;
    }
    if (filters.type && item.type !== filters.type) return false;
    if (filters.status && item.status !== filters.status) return false;
    if (filters.priority && item.priority !== filters.priority) return false;
    if (filters.periodStart && item.periodEnd && item.periodEnd < filters.periodStart) {
      return false;
    }
    if (filters.periodEnd && item.periodStart && item.periodStart > filters.periodEnd) {
      return false;
    }
    return true;
  });
}

function updateExpressionFromPatch(patch: Record<string, unknown>) {
  const names: Record<string, string> = {};
  const values: Record<string, AttributeValue> = {};
  const sets: string[] = [];
  const removes: string[] = [];
  Object.entries(patch).forEach(([key, value], index) => {
    const name = `#field${index}`;
    names[name] = key;
    if (value === undefined) {
      removes.push(name);
      return;
    }
    const valueName = `:value${index}`;
    values[valueName] = marshall({ value }, { removeUndefinedValues: true }).value;
    sets.push(`${name} = ${valueName}`);
  });
  return {
    names,
    values,
    expression: [
      sets.length ? `SET ${sets.join(", ")}` : "",
      removes.length ? `REMOVE ${removes.join(", ")}` : "",
    ]
      .filter(Boolean)
      .join(" "),
  };
}

export class CabinetOperationsRepository {
  static isConditionalFailure(error: unknown): boolean {
    return error instanceof ConditionalCheckFailedException;
  }

  static async createWork(work: CabinetWorkRecord): Promise<void> {
    await dynamoClient.send(
      new PutItemCommand({
        TableName: config.TABLE_NAME,
        Item: marshall(
          {
            PK: KeyFactory.cabinetPK(work.cabinetOrgId),
            SK: KeyFactory.cabinetWorkSK(work.workId),
            entityType: "ACCOUNTING_WORK",
            ...work,
            GSI1PK: KeyFactory.cabinetWorksGSI_PK(work.cabinetOrgId),
            GSI1SK: KeyFactory.cabinetWorkGSI_SK(work.dueDate, work.workId),
            GSI2PK: KeyFactory.cabinetDossierWorksGSI_PK(
              work.cabinetOrgId,
              work.dossierOrgId,
            ),
            GSI2SK: KeyFactory.cabinetWorkGSI_SK(work.dueDate, work.workId),
            GSI3PK: work.responsibleUserId
              ? KeyFactory.cabinetResponsibleWorksGSI_PK(
                  work.cabinetOrgId,
                  work.responsibleUserId,
                )
              : undefined,
            GSI3SK: work.responsibleUserId
              ? KeyFactory.cabinetWorkGSI_SK(work.dueDate, work.workId)
              : undefined,
          },
          { removeUndefinedValues: true },
        ),
        ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)",
      }),
    );
  }

  static async getWork(
    cabinetOrgId: string,
    workId: string,
  ): Promise<CabinetWorkRecord | undefined> {
    const result = await dynamoClient.send(
      new GetItemCommand({
        TableName: config.TABLE_NAME,
        Key: {
          PK: { S: KeyFactory.cabinetPK(cabinetOrgId) },
          SK: { S: KeyFactory.cabinetWorkSK(workId) },
        },
        ConsistentRead: true,
      }),
    );
    return toWorkRecord(result.Item);
  }

  static async updateWork(input: {
    cabinetOrgId: string;
    expectedStatus?: AccountingWorkStatus;
    patch: Partial<CabinetWorkRecord>;
    workId: string;
  }): Promise<CabinetWorkRecord | undefined> {
    const { expression, names, values } = updateExpressionFromPatch(input.patch);
    const result = await dynamoClient.send(
      new UpdateItemCommand({
        TableName: config.TABLE_NAME,
        Key: {
          PK: { S: KeyFactory.cabinetPK(input.cabinetOrgId) },
          SK: { S: KeyFactory.cabinetWorkSK(input.workId) },
        },
        ConditionExpression: input.expectedStatus
          ? "entityType = :entityType AND #expectedStatus = :expectedStatus"
          : "entityType = :entityType",
        UpdateExpression: expression,
        ExpressionAttributeNames: {
          ...names,
          ...(input.expectedStatus ? { "#expectedStatus": "status" } : {}),
        },
        ExpressionAttributeValues: {
          ...values,
          ":entityType": { S: "ACCOUNTING_WORK" },
          ...(input.expectedStatus
            ? { ":expectedStatus": { S: input.expectedStatus } }
            : {}),
        },
        ReturnValues: "ALL_NEW",
      }),
    );
    return toWorkRecord(result.Attributes);
  }

  static async listWorksByCabinet(input: QueryFilters & { cabinetOrgId: string }) {
    return this.queryWorks({
      ...input,
      indexName: config.GSI1,
      pkName: "GSI1PK",
      skName: "GSI1SK",
      pk: KeyFactory.cabinetWorksGSI_PK(input.cabinetOrgId),
      rangeStart: KeyFactory.cabinetWorkDueRangeStart(input.dueFrom),
      rangeEnd: KeyFactory.cabinetWorkDueRangeEnd(input.dueTo),
    });
  }

  static async listWorksByDossier(
    input: QueryFilters & { cabinetOrgId: string; dossierOrgId: string },
  ) {
    return this.queryWorks({
      ...input,
      indexName: config.GSI2,
      pkName: "GSI2PK",
      skName: "GSI2SK",
      pk: KeyFactory.cabinetDossierWorksGSI_PK(
        input.cabinetOrgId,
        input.dossierOrgId,
      ),
      rangeStart: KeyFactory.cabinetWorkDueRangeStart(input.dueFrom),
      rangeEnd: KeyFactory.cabinetWorkDueRangeEnd(input.dueTo),
    });
  }

  static async listWorksByResponsibleUser(
    input: QueryFilters & { cabinetOrgId: string; responsibleUserId: string },
  ) {
    return this.queryWorks({
      ...input,
      indexName: config.GSI3,
      pkName: "GSI3PK",
      skName: "GSI3SK",
      pk: KeyFactory.cabinetResponsibleWorksGSI_PK(
        input.cabinetOrgId,
        input.responsibleUserId,
      ),
      rangeStart: KeyFactory.cabinetWorkDueRangeStart(input.dueFrom),
      rangeEnd: KeyFactory.cabinetWorkDueRangeEnd(input.dueTo),
    });
  }

  private static async queryWorks(input: QueryFilters & {
    indexName: string;
    pk: string;
    pkName: string;
    rangeEnd: string;
    rangeStart: string;
    skName: string;
  }): Promise<Page<CabinetWorkRecord>> {
    const cursor = decodeCursor(input.cursor);
    const result = await dynamoClient.send(
      new QueryCommand({
        TableName: config.TABLE_NAME,
        IndexName: input.indexName,
        KeyConditionExpression: `#pk = :pk AND #sk BETWEEN :from AND :to`,
        ExpressionAttributeNames: { "#pk": input.pkName, "#sk": input.skName },
        ExpressionAttributeValues: {
          ":pk": { S: input.pk },
          ":from": { S: input.rangeStart },
          ":to": { S: input.rangeEnd },
        },
        ExclusiveStartKey: cursor,
        Limit: input.limit,
      }),
    );
    return {
      items: applyCommonFilters(
        (result.Items ?? [])
          .map(toWorkRecord)
          .filter((item): item is CabinetWorkRecord => Boolean(item)),
        input,
      ),
      nextCursor: encodeCursor(result.LastEvaluatedKey),
    };
  }

  static async createDeadline(deadline: CabinetDeadlineRecord): Promise<void> {
    await dynamoClient.send(
      new PutItemCommand({
        TableName: config.TABLE_NAME,
        Item: marshall(
          {
            PK: KeyFactory.cabinetPK(deadline.cabinetOrgId),
            SK: KeyFactory.cabinetDeadlineSK(deadline.deadlineId),
            entityType: "CABINET_DEADLINE",
            ...deadline,
            GSI1PK: KeyFactory.cabinetDeadlinesGSI_PK(deadline.cabinetOrgId),
            GSI1SK: KeyFactory.cabinetDeadlineGSI_SK(
              deadline.dueDate,
              deadline.deadlineId,
            ),
            GSI2PK: KeyFactory.cabinetDossierDeadlinesGSI_PK(
              deadline.cabinetOrgId,
              deadline.dossierOrgId,
            ),
            GSI2SK: KeyFactory.cabinetDeadlineGSI_SK(
              deadline.dueDate,
              deadline.deadlineId,
            ),
            GSI3PK: deadline.responsibleUserId
              ? KeyFactory.cabinetResponsibleDeadlinesGSI_PK(
                  deadline.cabinetOrgId,
                  deadline.responsibleUserId,
                )
              : undefined,
            GSI3SK: deadline.responsibleUserId
              ? KeyFactory.cabinetDeadlineGSI_SK(
                  deadline.dueDate,
                  deadline.deadlineId,
                )
              : undefined,
          },
          { removeUndefinedValues: true },
        ),
        ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)",
      }),
    );
  }

  static async getDeadline(
    cabinetOrgId: string,
    deadlineId: string,
  ): Promise<CabinetDeadlineRecord | undefined> {
    const result = await dynamoClient.send(
      new GetItemCommand({
        TableName: config.TABLE_NAME,
        Key: {
          PK: { S: KeyFactory.cabinetPK(cabinetOrgId) },
          SK: { S: KeyFactory.cabinetDeadlineSK(deadlineId) },
        },
        ConsistentRead: true,
      }),
    );
    return toDeadlineRecord(result.Item);
  }

  static async updateDeadline(input: {
    cabinetOrgId: string;
    deadlineId: string;
    expectedStatus?: CabinetDeadlineStatus;
    patch: Partial<CabinetDeadlineRecord>;
  }): Promise<CabinetDeadlineRecord | undefined> {
    const { expression, names, values } = updateExpressionFromPatch(input.patch);
    const result = await dynamoClient.send(
      new UpdateItemCommand({
        TableName: config.TABLE_NAME,
        Key: {
          PK: { S: KeyFactory.cabinetPK(input.cabinetOrgId) },
          SK: { S: KeyFactory.cabinetDeadlineSK(input.deadlineId) },
        },
        ConditionExpression: input.expectedStatus
          ? "entityType = :entityType AND #expectedStatus = :expectedStatus"
          : "entityType = :entityType",
        UpdateExpression: expression,
        ExpressionAttributeNames: {
          ...names,
          ...(input.expectedStatus ? { "#expectedStatus": "status" } : {}),
        },
        ExpressionAttributeValues: {
          ...values,
          ":entityType": { S: "CABINET_DEADLINE" },
          ...(input.expectedStatus
            ? { ":expectedStatus": { S: input.expectedStatus } }
            : {}),
        },
        ReturnValues: "ALL_NEW",
      }),
    );
    return toDeadlineRecord(result.Attributes);
  }

  static async listDeadlinesByCabinet(
    input: QueryFilters & { cabinetOrgId: string },
  ) {
    return this.queryDeadlines({
      ...input,
      indexName: config.GSI1,
      pkName: "GSI1PK",
      skName: "GSI1SK",
      pk: KeyFactory.cabinetDeadlinesGSI_PK(input.cabinetOrgId),
      rangeStart: KeyFactory.cabinetDeadlineDueRangeStart(input.dueFrom),
      rangeEnd: KeyFactory.cabinetDeadlineDueRangeEnd(input.dueTo),
    });
  }

  static async listDeadlinesByDossier(
    input: QueryFilters & { cabinetOrgId: string; dossierOrgId: string },
  ) {
    return this.queryDeadlines({
      ...input,
      indexName: config.GSI2,
      pkName: "GSI2PK",
      skName: "GSI2SK",
      pk: KeyFactory.cabinetDossierDeadlinesGSI_PK(
        input.cabinetOrgId,
        input.dossierOrgId,
      ),
      rangeStart: KeyFactory.cabinetDeadlineDueRangeStart(input.dueFrom),
      rangeEnd: KeyFactory.cabinetDeadlineDueRangeEnd(input.dueTo),
    });
  }

  static async listDeadlinesByResponsibleUser(
    input: QueryFilters & { cabinetOrgId: string; responsibleUserId: string },
  ) {
    return this.queryDeadlines({
      ...input,
      indexName: config.GSI3,
      pkName: "GSI3PK",
      skName: "GSI3SK",
      pk: KeyFactory.cabinetResponsibleDeadlinesGSI_PK(
        input.cabinetOrgId,
        input.responsibleUserId,
      ),
      rangeStart: KeyFactory.cabinetDeadlineDueRangeStart(input.dueFrom),
      rangeEnd: KeyFactory.cabinetDeadlineDueRangeEnd(input.dueTo),
    });
  }

  private static async queryDeadlines(input: QueryFilters & {
    indexName: string;
    pk: string;
    pkName: string;
    rangeEnd: string;
    rangeStart: string;
    skName: string;
  }): Promise<Page<CabinetDeadlineRecord>> {
    const cursor = decodeCursor(input.cursor);
    const result = await dynamoClient.send(
      new QueryCommand({
        TableName: config.TABLE_NAME,
        IndexName: input.indexName,
        KeyConditionExpression: `#pk = :pk AND #sk BETWEEN :from AND :to`,
        ExpressionAttributeNames: { "#pk": input.pkName, "#sk": input.skName },
        ExpressionAttributeValues: {
          ":pk": { S: input.pk },
          ":from": { S: input.rangeStart },
          ":to": { S: input.rangeEnd },
        },
        ExclusiveStartKey: cursor,
        Limit: input.limit,
      }),
    );
    const filtered = applyCommonFilters(
      (result.Items ?? [])
        .map(toDeadlineRecord)
        .filter((item): item is CabinetDeadlineRecord => Boolean(item)),
      input,
    ).filter((item) => {
      if (!input.overdue) return true;
      return Boolean(input.today && item.dueDate < input.today && item.status === "PENDING");
    });
    return {
      items: filtered,
      nextCursor: encodeCursor(result.LastEvaluatedKey),
    };
  }
}
