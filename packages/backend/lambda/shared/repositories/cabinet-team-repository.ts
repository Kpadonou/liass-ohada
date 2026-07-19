import {
  AttributeValue,
  BatchGetItemCommand,
  DeleteItemCommand,
  GetItemCommand,
  QueryCommand,
  TransactWriteItem,
  TransactWriteItemsCommand,
  UpdateItemCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import type {
  CabinetInvitationStatus,
  CabinetMemberStatus,
  CabinetRole,
} from "@liass-ohada/shared";
import { config, dynamoClient } from "../dynamo-client";
import { KeyFactory } from "../key-builder";

export interface CabinetMemberRecord {
  orgId: string;
  userId: string;
  role?: string;
  cabinetRole?: CabinetRole;
  status: CabinetMemberStatus;
  cabinetId?: string;
  accessSource?: string;
  displayName?: string;
  email?: string;
  workspaceType?: string;
  country?: string;
  accountingFramework?: string;
  joinedAt?: string;
  invitedBy?: string;
  createdAt?: string;
  updatedAt: string;
  updatedBy?: string;
  GSI6PK?: string;
  GSI6SK?: string;
}

export interface CabinetInvitationRecord {
  invitationId: string;
  cabinetOrgId: string;
  cabinetId: string;
  normalizedEmail: string;
  displayEmail: string;
  role: CabinetRole;
  status: CabinetInvitationStatus;
  invitedBy: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  tokenHash: string;
  initialDossierOrgIds: string[];
  acceptedAt?: string;
  acceptedByUserId?: string;
  cancelledAt?: string;
  cancelledBy?: string;
}

export interface CabinetInvitationEmailLockRecord {
  invitationId: string;
  normalizedEmail: string;
  expiresAt: string;
  createdAt: string;
}

export interface InvitationTokenLookupRecord {
  cabinetOrgId: string;
  cabinetId: string;
  invitationId: string;
  normalizedEmail: string;
  expiresAt: string;
  createdAt: string;
}

export interface CabinetDossierAssignmentRecord {
  cabinetOrgId: string;
  userId: string;
  dossierOrgId: string;
  assignedBy: string;
  assignedAt: string;
}

export interface CabinetDossierRecord {
  cabinetId: string;
  orgId: string;
  displayName?: string;
  status: string;
  relationship?: string;
}

export interface OrganizationRecord {
  orgId: string;
  name: string;
  workspaceType: string;
  status: string;
  country?: string;
  accountingFramework?: string;
}

export interface CabinetMetadataRecord {
  cabinetId: string;
  orgId: string;
  ownerUserId?: string;
  status: string;
}

interface Page<T> {
  items: T[];
  nextCursor?: string;
}

const isCabinetRole = (value: unknown): value is CabinetRole =>
  typeof value === "string" &&
  ["CABINET_ADMIN", "SUPERVISOR", "COLLABORATOR", "READER"].includes(value);

const isMemberStatus = (value: unknown): value is CabinetMemberStatus =>
  typeof value === "string" &&
  ["ACTIVE", "SUSPENDED", "REVOKED"].includes(value);

const isInvitationStatus = (
  value: unknown,
): value is CabinetInvitationStatus =>
  typeof value === "string" &&
  ["PENDING", "ACCEPTED", "EXPIRED", "CANCELLED"].includes(value);

function toMemberRecord(item?: Record<string, AttributeValue>): CabinetMemberRecord | undefined {
  if (!item) return undefined;
  const value = unmarshall(item);
  if (
    value.entityType !== "USER_ORG_ACCESS" ||
    typeof value.orgId !== "string" ||
    typeof value.userId !== "string" ||
    !isMemberStatus(value.status)
  ) {
    return undefined;
  }

  return {
    orgId: value.orgId,
    userId: value.userId,
    role: typeof value.role === "string" ? value.role : undefined,
    cabinetRole: isCabinetRole(value.cabinetRole) ? value.cabinetRole : undefined,
    status: value.status,
    cabinetId: typeof value.cabinetId === "string" ? value.cabinetId : undefined,
    accessSource:
      typeof value.accessSource === "string" ? value.accessSource : undefined,
    displayName:
      typeof value.memberDisplayName === "string"
        ? value.memberDisplayName
        : undefined,
    email: typeof value.email === "string" ? value.email : undefined,
    workspaceType:
      typeof value.workspaceType === "string" ? value.workspaceType : undefined,
    country: typeof value.country === "string" ? value.country : undefined,
    accountingFramework:
      typeof value.accountingFramework === "string"
        ? value.accountingFramework
        : undefined,
    joinedAt: typeof value.joinedAt === "string" ? value.joinedAt : undefined,
    invitedBy: typeof value.invitedBy === "string" ? value.invitedBy : undefined,
    createdAt: typeof value.createdAt === "string" ? value.createdAt : undefined,
    updatedAt:
      typeof value.updatedAt === "string"
        ? value.updatedAt
        : typeof value.createdAt === "string"
          ? value.createdAt
          : new Date(0).toISOString(),
    updatedBy: typeof value.updatedBy === "string" ? value.updatedBy : undefined,
    GSI6PK: typeof value.GSI6PK === "string" ? value.GSI6PK : undefined,
    GSI6SK: typeof value.GSI6SK === "string" ? value.GSI6SK : undefined,
  };
}

function toInvitationRecord(
  item?: Record<string, AttributeValue>,
): CabinetInvitationRecord | undefined {
  if (!item) return undefined;
  const value = unmarshall(item);
  if (
    value.entityType !== "CABINET_INVITATION" ||
    typeof value.invitationId !== "string" ||
    typeof value.cabinetOrgId !== "string" ||
    typeof value.cabinetId !== "string" ||
    typeof value.normalizedEmail !== "string" ||
    typeof value.displayEmail !== "string" ||
    !isCabinetRole(value.role) ||
    !isInvitationStatus(value.status) ||
    typeof value.invitedBy !== "string" ||
    typeof value.createdAt !== "string" ||
    typeof value.updatedAt !== "string" ||
    typeof value.expiresAt !== "string" ||
    typeof value.tokenHash !== "string"
  ) {
    return undefined;
  }

  return {
    invitationId: value.invitationId,
    cabinetOrgId: value.cabinetOrgId,
    cabinetId: value.cabinetId,
    normalizedEmail: value.normalizedEmail,
    displayEmail: value.displayEmail,
    role: value.role,
    status: value.status,
    invitedBy: value.invitedBy,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    expiresAt: value.expiresAt,
    tokenHash: value.tokenHash,
    initialDossierOrgIds: Array.isArray(value.initialDossierOrgIds)
      ? value.initialDossierOrgIds.filter(
          (id: unknown): id is string => typeof id === "string",
        )
      : [],
    acceptedAt:
      typeof value.acceptedAt === "string" ? value.acceptedAt : undefined,
    acceptedByUserId:
      typeof value.acceptedByUserId === "string"
        ? value.acceptedByUserId
        : undefined,
    cancelledAt:
      typeof value.cancelledAt === "string" ? value.cancelledAt : undefined,
    cancelledBy:
      typeof value.cancelledBy === "string" ? value.cancelledBy : undefined,
  };
}

function toAssignmentRecord(
  item?: Record<string, AttributeValue>,
): CabinetDossierAssignmentRecord | undefined {
  if (!item) return undefined;
  const value = unmarshall(item);
  if (
    value.entityType !== "CABINET_DOSSIER_ASSIGNMENT" ||
    typeof value.cabinetOrgId !== "string" ||
    typeof value.userId !== "string" ||
    typeof value.dossierOrgId !== "string" ||
    typeof value.assignedBy !== "string" ||
    typeof value.assignedAt !== "string"
  ) {
    return undefined;
  }
  return {
    cabinetOrgId: value.cabinetOrgId,
    userId: value.userId,
    dossierOrgId: value.dossierOrgId,
    assignedBy: value.assignedBy,
    assignedAt: value.assignedAt,
  };
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
    if (!value || typeof value !== "object" || !value.PK || !value.SK) {
      throw new Error("Invalid cursor");
    }
    return value;
  } catch {
    throw new Error("Invalid cursor");
  }
}

function putIfAbsent(item: Record<string, unknown>): TransactWriteItem {
  return {
    Put: {
      TableName: config.TABLE_NAME,
      Item: marshall(item, { removeUndefinedValues: true }),
      ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)",
    },
  };
}

export class CabinetTeamRepository {
  static async getMember(
    cabinetOrgId: string,
    userId: string,
  ): Promise<CabinetMemberRecord | undefined> {
    const result = await dynamoClient.send(
      new GetItemCommand({
        TableName: config.TABLE_NAME,
        Key: {
          PK: { S: KeyFactory.orgKey(cabinetOrgId) },
          SK: { S: KeyFactory.orgUserAccessSK(userId) },
        },
        ConsistentRead: true,
      }),
    );
    return toMemberRecord(result.Item);
  }

  static async listMembers(input: {
    cabinetOrgId: string;
    limit: number;
    cursor?: string;
    role?: CabinetRole;
    status?: CabinetMemberStatus;
  }): Promise<Page<CabinetMemberRecord>> {
    const names: Record<string, string> = {};
    const values: Record<string, AttributeValue> = {
      ":pk": { S: KeyFactory.orgKey(input.cabinetOrgId) },
      ":prefix": { S: KeyFactory.orgUserAccessPrefix() },
      ":entityType": { S: "USER_ORG_ACCESS" },
    };
    const filters = ["entityType = :entityType"];
    if (input.role) {
      names["#cabinetRole"] = "cabinetRole";
      values[":cabinetRole"] = { S: input.role };
      filters.push("#cabinetRole = :cabinetRole");
    }
    if (input.status) {
      names["#status"] = "status";
      values[":status"] = { S: input.status };
      filters.push("#status = :status");
    }

    const cursor = decodeCursor(input.cursor);
    if (cursor && cursor.PK?.S !== KeyFactory.orgKey(input.cabinetOrgId)) {
      throw new Error("Invalid cursor");
    }

    const result = await dynamoClient.send(
      new QueryCommand({
        TableName: config.TABLE_NAME,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :prefix)",
        FilterExpression: filters.join(" AND "),
        ExpressionAttributeNames:
          Object.keys(names).length > 0 ? names : undefined,
        ExpressionAttributeValues: values,
        ExclusiveStartKey: cursor,
        Limit: input.limit,
      }),
    );

    return {
      items: (result.Items ?? [])
        .map(toMemberRecord)
        .filter((item): item is CabinetMemberRecord => Boolean(item)),
      nextCursor: encodeCursor(result.LastEvaluatedKey),
    };
  }

  static async listAllMembers(
    cabinetOrgId: string,
  ): Promise<CabinetMemberRecord[]> {
    const members: CabinetMemberRecord[] = [];
    let lastKey: Record<string, AttributeValue> | undefined;
    do {
      const result = await dynamoClient.send(
        new QueryCommand({
          TableName: config.TABLE_NAME,
          KeyConditionExpression: "PK = :pk AND begins_with(SK, :prefix)",
          FilterExpression: "entityType = :entityType",
          ExpressionAttributeValues: {
            ":pk": { S: KeyFactory.orgKey(cabinetOrgId) },
            ":prefix": { S: KeyFactory.orgUserAccessPrefix() },
            ":entityType": { S: "USER_ORG_ACCESS" },
          },
          ExclusiveStartKey: lastKey,
        }),
      );
      members.push(
        ...(result.Items ?? [])
          .map(toMemberRecord)
          .filter((item): item is CabinetMemberRecord => Boolean(item)),
      );
      lastKey = result.LastEvaluatedKey;
    } while (lastKey);
    return members;
  }

  static async updateMemberRole(input: {
    cabinetOrgId: string;
    userId: string;
    currentRole: CabinetRole;
    role: CabinetRole;
    actorUserId: string;
    now: string;
  }): Promise<CabinetMemberRecord | undefined> {
    const result = await dynamoClient.send(
      new UpdateItemCommand({
        TableName: config.TABLE_NAME,
        Key: {
          PK: { S: KeyFactory.orgKey(input.cabinetOrgId) },
          SK: { S: KeyFactory.orgUserAccessSK(input.userId) },
        },
        ConditionExpression:
          "entityType = :entityType AND cabinetRole = :currentRole AND #status <> :revoked",
        UpdateExpression:
          "SET cabinetRole = :role, updatedAt = :now, updatedBy = :actor",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: {
          ":entityType": { S: "USER_ORG_ACCESS" },
          ":currentRole": { S: input.currentRole },
          ":role": { S: input.role },
          ":revoked": { S: "REVOKED" },
          ":now": { S: input.now },
          ":actor": { S: input.actorUserId },
        },
        ReturnValues: "ALL_NEW",
      }),
    );
    return toMemberRecord(result.Attributes);
  }

  static async updateMemberStatus(input: {
    cabinetOrgId: string;
    userId: string;
    currentStatus: CabinetMemberStatus;
    status: CabinetMemberStatus;
    actorUserId: string;
    now: string;
  }): Promise<CabinetMemberRecord | undefined> {
    const result = await dynamoClient.send(
      new UpdateItemCommand({
        TableName: config.TABLE_NAME,
        Key: {
          PK: { S: KeyFactory.orgKey(input.cabinetOrgId) },
          SK: { S: KeyFactory.orgUserAccessSK(input.userId) },
        },
        ConditionExpression:
          "entityType = :entityType AND #status = :currentStatus",
        UpdateExpression:
          "SET #status = :status, GSI6PK = :gsi6pk, GSI6SK = :gsi6sk, updatedAt = :now, updatedBy = :actor",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: {
          ":entityType": { S: "USER_ORG_ACCESS" },
          ":currentStatus": { S: input.currentStatus },
          ":status": { S: input.status },
          ":gsi6pk": { S: KeyFactory.userWorkspacesPK(input.userId) },
          ":gsi6sk": {
            S: KeyFactory.userWorkspaceSK(input.status, input.cabinetOrgId),
          },
          ":now": { S: input.now },
          ":actor": { S: input.actorUserId },
        },
        ReturnValues: "ALL_NEW",
      }),
    );
    return toMemberRecord(result.Attributes);
  }

  static async getInvitation(
    cabinetOrgId: string,
    invitationId: string,
  ): Promise<CabinetInvitationRecord | undefined> {
    const result = await dynamoClient.send(
      new GetItemCommand({
        TableName: config.TABLE_NAME,
        Key: {
          PK: { S: KeyFactory.cabinetPK(cabinetOrgId) },
          SK: { S: KeyFactory.cabinetInvitationSK(invitationId) },
        },
        ConsistentRead: true,
      }),
    );
    return toInvitationRecord(result.Item);
  }

  static async getInvitationEmailLock(
    cabinetOrgId: string,
    normalizedEmail: string,
  ): Promise<CabinetInvitationEmailLockRecord | undefined> {
    const result = await dynamoClient.send(
      new GetItemCommand({
        TableName: config.TABLE_NAME,
        Key: {
          PK: { S: KeyFactory.cabinetPK(cabinetOrgId) },
          SK: {
            S: KeyFactory.cabinetInvitationEmailLockSK(normalizedEmail),
          },
        },
        ConsistentRead: true,
      }),
    );
    if (!result.Item) return undefined;
    const value = unmarshall(result.Item);
    if (
      value.entityType !== "INVITATION_EMAIL_LOCK" ||
      typeof value.invitationId !== "string" ||
      typeof value.normalizedEmail !== "string" ||
      typeof value.expiresAt !== "string" ||
      typeof value.createdAt !== "string"
    ) {
      return undefined;
    }
    return {
      invitationId: value.invitationId,
      normalizedEmail: value.normalizedEmail,
      expiresAt: value.expiresAt,
      createdAt: value.createdAt,
    };
  }

  static async getInvitationTokenLookup(
    tokenHash: string,
  ): Promise<InvitationTokenLookupRecord | undefined> {
    const result = await dynamoClient.send(
      new GetItemCommand({
        TableName: config.TABLE_NAME,
        Key: {
          PK: { S: KeyFactory.invitationTokenPK(tokenHash) },
          SK: { S: KeyFactory.invitationTokenSK() },
        },
        ConsistentRead: true,
      }),
    );
    if (!result.Item) return undefined;
    const value = unmarshall(result.Item);
    if (
      value.entityType !== "INVITATION_TOKEN_LOOKUP" ||
      typeof value.cabinetOrgId !== "string" ||
      typeof value.cabinetId !== "string" ||
      typeof value.invitationId !== "string" ||
      typeof value.normalizedEmail !== "string" ||
      typeof value.expiresAt !== "string" ||
      typeof value.createdAt !== "string"
    ) {
      return undefined;
    }
    return {
      cabinetOrgId: value.cabinetOrgId,
      cabinetId: value.cabinetId,
      invitationId: value.invitationId,
      normalizedEmail: value.normalizedEmail,
      expiresAt: value.expiresAt,
      createdAt: value.createdAt,
    };
  }

  static async deleteStaleInvitationEmailLock(input: {
    cabinetOrgId: string;
    normalizedEmail: string;
    invitationId: string;
  }): Promise<void> {
    await dynamoClient.send(
      new DeleteItemCommand({
        TableName: config.TABLE_NAME,
        Key: {
          PK: { S: KeyFactory.cabinetPK(input.cabinetOrgId) },
          SK: {
            S: KeyFactory.cabinetInvitationEmailLockSK(input.normalizedEmail),
          },
        },
        ConditionExpression: "invitationId = :invitationId",
        ExpressionAttributeValues: {
          ":invitationId": { S: input.invitationId },
        },
      }),
    );
  }

  static async createInvitation(input: {
    invitation: CabinetInvitationRecord;
  }): Promise<void> {
    const value = input.invitation;
    await dynamoClient.send(
      new TransactWriteItemsCommand({
        TransactItems: [
          putIfAbsent({
            PK: KeyFactory.cabinetPK(value.cabinetOrgId),
            SK: KeyFactory.cabinetInvitationSK(value.invitationId),
            entityType: "CABINET_INVITATION",
            ...value,
            GSI1PK: KeyFactory.cabinetInvitationsGSI_PK(value.cabinetOrgId),
            GSI1SK: KeyFactory.cabinetInvitationsGSI_SK(
              value.status,
              value.createdAt,
              value.invitationId,
            ),
          }),
          putIfAbsent({
            PK: KeyFactory.cabinetPK(value.cabinetOrgId),
            SK: KeyFactory.cabinetInvitationEmailLockSK(value.normalizedEmail),
            entityType: "INVITATION_EMAIL_LOCK",
            invitationId: value.invitationId,
            normalizedEmail: value.normalizedEmail,
            expiresAt: value.expiresAt,
            createdAt: value.createdAt,
          }),
          putIfAbsent({
            PK: KeyFactory.invitationTokenPK(value.tokenHash),
            SK: KeyFactory.invitationTokenSK(),
            entityType: "INVITATION_TOKEN_LOOKUP",
            cabinetOrgId: value.cabinetOrgId,
            cabinetId: value.cabinetId,
            invitationId: value.invitationId,
            normalizedEmail: value.normalizedEmail,
            expiresAt: value.expiresAt,
            createdAt: value.createdAt,
          }),
        ],
      }),
    );
  }

  static async listInvitations(input: {
    cabinetOrgId: string;
    limit: number;
    cursor?: string;
    status?: CabinetInvitationStatus;
  }): Promise<Page<CabinetInvitationRecord>> {
    const cursor = decodeCursor(input.cursor);
    const gsiPk = KeyFactory.cabinetInvitationsGSI_PK(input.cabinetOrgId);
    if (cursor && cursor.GSI1PK?.S !== gsiPk) {
      throw new Error("Invalid cursor");
    }
    const values: Record<string, AttributeValue> = { ":pk": { S: gsiPk } };
    let keyCondition = "GSI1PK = :pk";
    if (input.status) {
      keyCondition += " AND begins_with(GSI1SK, :statusPrefix)";
      values[":statusPrefix"] = {
        S: KeyFactory.cabinetInvitationStatusPrefix(input.status),
      };
    }
    const result = await dynamoClient.send(
      new QueryCommand({
        TableName: config.TABLE_NAME,
        IndexName: config.GSI1,
        KeyConditionExpression: keyCondition,
        ExpressionAttributeValues: values,
        ExclusiveStartKey: cursor,
        Limit: input.limit,
        ScanIndexForward: false,
      }),
    );
    return {
      items: (result.Items ?? [])
        .map(toInvitationRecord)
        .filter((item): item is CabinetInvitationRecord => Boolean(item)),
      nextCursor: encodeCursor(result.LastEvaluatedKey),
    };
  }

  static async expireInvitation(input: {
    invitation: CabinetInvitationRecord;
    now: string;
  }): Promise<void> {
    const value = input.invitation;
    await dynamoClient.send(
      new TransactWriteItemsCommand({
        TransactItems: [
          {
            Update: {
              TableName: config.TABLE_NAME,
              Key: marshall({
                PK: KeyFactory.cabinetPK(value.cabinetOrgId),
                SK: KeyFactory.cabinetInvitationSK(value.invitationId),
              }),
              ConditionExpression:
                "#status = :pending AND tokenHash = :tokenHash",
              UpdateExpression:
                "SET #status = :expired, updatedAt = :now, GSI1SK = :gsi1sk",
              ExpressionAttributeNames: { "#status": "status" },
              ExpressionAttributeValues: marshall({
                ":pending": "PENDING",
                ":expired": "EXPIRED",
                ":tokenHash": value.tokenHash,
                ":now": input.now,
                ":gsi1sk": KeyFactory.cabinetInvitationsGSI_SK(
                  "EXPIRED",
                  value.createdAt,
                  value.invitationId,
                ),
              }),
            },
          },
          {
            Delete: {
              TableName: config.TABLE_NAME,
              Key: marshall({
                PK: KeyFactory.cabinetPK(value.cabinetOrgId),
                SK: KeyFactory.cabinetInvitationEmailLockSK(
                  value.normalizedEmail,
                ),
              }),
            },
          },
          {
            Delete: {
              TableName: config.TABLE_NAME,
              Key: marshall({
                PK: KeyFactory.invitationTokenPK(value.tokenHash),
                SK: KeyFactory.invitationTokenSK(),
              }),
            },
          },
        ],
      }),
    );
  }

  static async cancelInvitation(input: {
    invitation: CabinetInvitationRecord;
    actorUserId: string;
    now: string;
  }): Promise<void> {
    const value = input.invitation;
    await dynamoClient.send(
      new TransactWriteItemsCommand({
        TransactItems: [
          {
            Update: {
              TableName: config.TABLE_NAME,
              Key: marshall({
                PK: KeyFactory.cabinetPK(value.cabinetOrgId),
                SK: KeyFactory.cabinetInvitationSK(value.invitationId),
              }),
              ConditionExpression:
                "#status = :pending AND tokenHash = :tokenHash",
              UpdateExpression:
                "SET #status = :cancelled, cancelledAt = :now, cancelledBy = :actor, updatedAt = :now, GSI1SK = :gsi1sk",
              ExpressionAttributeNames: { "#status": "status" },
              ExpressionAttributeValues: marshall({
                ":pending": "PENDING",
                ":cancelled": "CANCELLED",
                ":tokenHash": value.tokenHash,
                ":now": input.now,
                ":actor": input.actorUserId,
                ":gsi1sk": KeyFactory.cabinetInvitationsGSI_SK(
                  "CANCELLED",
                  value.createdAt,
                  value.invitationId,
                ),
              }),
            },
          },
          {
            Delete: {
              TableName: config.TABLE_NAME,
              Key: marshall({
                PK: KeyFactory.cabinetPK(value.cabinetOrgId),
                SK: KeyFactory.cabinetInvitationEmailLockSK(
                  value.normalizedEmail,
                ),
              }),
            },
          },
          {
            Delete: {
              TableName: config.TABLE_NAME,
              Key: marshall({
                PK: KeyFactory.invitationTokenPK(value.tokenHash),
                SK: KeyFactory.invitationTokenSK(),
              }),
            },
          },
        ],
      }),
    );
  }

  static async resendInvitation(input: {
    invitation: CabinetInvitationRecord;
    newTokenHash: string;
    expiresAt: string;
    now: string;
  }): Promise<void> {
    const value = input.invitation;
    await dynamoClient.send(
      new TransactWriteItemsCommand({
        TransactItems: [
          {
            Update: {
              TableName: config.TABLE_NAME,
              Key: marshall({
                PK: KeyFactory.cabinetPK(value.cabinetOrgId),
                SK: KeyFactory.cabinetInvitationSK(value.invitationId),
              }),
              ConditionExpression:
                "#status = :pending AND tokenHash = :oldTokenHash",
              UpdateExpression:
                "SET tokenHash = :newTokenHash, expiresAt = :expiresAt, updatedAt = :now",
              ExpressionAttributeNames: { "#status": "status" },
              ExpressionAttributeValues: marshall({
                ":pending": "PENDING",
                ":oldTokenHash": value.tokenHash,
                ":newTokenHash": input.newTokenHash,
                ":expiresAt": input.expiresAt,
                ":now": input.now,
              }),
            },
          },
          {
            Delete: {
              TableName: config.TABLE_NAME,
              Key: marshall({
                PK: KeyFactory.invitationTokenPK(value.tokenHash),
                SK: KeyFactory.invitationTokenSK(),
              }),
              ConditionExpression: "attribute_exists(PK)",
            },
          },
          putIfAbsent({
            PK: KeyFactory.invitationTokenPK(input.newTokenHash),
            SK: KeyFactory.invitationTokenSK(),
            entityType: "INVITATION_TOKEN_LOOKUP",
            cabinetOrgId: value.cabinetOrgId,
            cabinetId: value.cabinetId,
            invitationId: value.invitationId,
            normalizedEmail: value.normalizedEmail,
            expiresAt: input.expiresAt,
            createdAt: input.now,
          }),
          {
            Update: {
              TableName: config.TABLE_NAME,
              Key: marshall({
                PK: KeyFactory.cabinetPK(value.cabinetOrgId),
                SK: KeyFactory.cabinetInvitationEmailLockSK(
                  value.normalizedEmail,
                ),
              }),
              ConditionExpression: "invitationId = :invitationId",
              UpdateExpression: "SET expiresAt = :expiresAt",
              ExpressionAttributeValues: marshall({
                ":invitationId": value.invitationId,
                ":expiresAt": input.expiresAt,
              }),
            },
          },
        ],
      }),
    );
  }

  static async getDossiers(
    cabinetId: string,
    dossierOrgIds: string[],
  ): Promise<CabinetDossierRecord[]> {
    if (dossierOrgIds.length === 0) return [];
    const result = await dynamoClient.send(
      new BatchGetItemCommand({
        RequestItems: {
          [config.TABLE_NAME]: {
            Keys: dossierOrgIds.map((orgId) => ({
              PK: { S: KeyFactory.cabinetPK(cabinetId) },
              SK: { S: KeyFactory.cabinetDossierSK(orgId) },
            })),
            ConsistentRead: true,
          },
        },
      }),
    );
    return (result.Responses?.[config.TABLE_NAME] ?? [])
      .map((item) => unmarshall(item))
      .filter((value) => value.entityType === "CABINET_DOSSIER")
      .map((value) => ({
        cabinetId: String(value.cabinetId),
        orgId: String(value.orgId),
        displayName:
          typeof value.displayName === "string" ? value.displayName : undefined,
        status: String(value.status),
        relationship:
          typeof value.relationship === "string" ? value.relationship : undefined,
      }));
  }

  static async getOrganization(
    orgId: string,
  ): Promise<OrganizationRecord | undefined> {
    const result = await dynamoClient.send(
      new GetItemCommand({
        TableName: config.TABLE_NAME,
        Key: {
          PK: { S: KeyFactory.orgKey(orgId) },
          SK: { S: KeyFactory.organizationSK() },
        },
        ConsistentRead: true,
      }),
    );
    if (!result.Item) return undefined;
    const value = unmarshall(result.Item);
    if (
      value.entityType !== "ORGANIZATION" ||
      typeof value.orgId !== "string" ||
      typeof value.name !== "string" ||
      typeof value.workspaceType !== "string" ||
      typeof value.status !== "string"
    ) {
      return undefined;
    }
    return {
      orgId: value.orgId,
      name: value.name,
      workspaceType: value.workspaceType,
      status: value.status,
      country: typeof value.country === "string" ? value.country : undefined,
      accountingFramework:
        typeof value.accountingFramework === "string"
          ? value.accountingFramework
          : undefined,
    };
  }

  static async getCabinetMetadata(
    cabinetId: string,
  ): Promise<CabinetMetadataRecord | undefined> {
    const result = await dynamoClient.send(
      new GetItemCommand({
        TableName: config.TABLE_NAME,
        Key: {
          PK: { S: KeyFactory.cabinetPK(cabinetId) },
          SK: { S: KeyFactory.cabinetMetadataSK() },
        },
        ConsistentRead: true,
      }),
    );
    if (!result.Item) return undefined;
    const value = unmarshall(result.Item);
    if (
      value.entityType !== "CABINET" ||
      typeof value.cabinetId !== "string" ||
      typeof value.orgId !== "string" ||
      typeof value.status !== "string"
    ) {
      return undefined;
    }
    return {
      cabinetId: value.cabinetId,
      orgId: value.orgId,
      ownerUserId:
        typeof value.ownerUserId === "string" ? value.ownerUserId : undefined,
      status: value.status,
    };
  }

  static async listMemberAssignments(
    cabinetOrgId: string,
    userId: string,
  ): Promise<CabinetDossierAssignmentRecord[]> {
    const result = await dynamoClient.send(
      new QueryCommand({
        TableName: config.TABLE_NAME,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :prefix)",
        ExpressionAttributeValues: {
          ":pk": { S: KeyFactory.cabinetPK(cabinetOrgId) },
          ":prefix": {
            S: KeyFactory.cabinetMemberAssignmentsPrefix(userId),
          },
        },
      }),
    );
    return (result.Items ?? [])
      .map(toAssignmentRecord)
      .filter((item): item is CabinetDossierAssignmentRecord => Boolean(item));
  }

  static async listDossierAssignments(
    cabinetOrgId: string,
    dossierOrgId: string,
  ): Promise<CabinetDossierAssignmentRecord[]> {
    const result = await dynamoClient.send(
      new QueryCommand({
        TableName: config.TABLE_NAME,
        IndexName: config.GSI1,
        KeyConditionExpression:
          "GSI1PK = :pk AND begins_with(GSI1SK, :prefix)",
        ExpressionAttributeValues: {
          ":pk": {
            S: KeyFactory.cabinetDossierAssignmentsGSI_PK(
              cabinetOrgId,
              dossierOrgId,
            ),
          },
          ":prefix": { S: KeyFactory.orgUserAccessPrefix() },
        },
      }),
    );
    return (result.Items ?? [])
      .map(toAssignmentRecord)
      .filter((item): item is CabinetDossierAssignmentRecord => Boolean(item));
  }

  static async batchGetMembers(
    cabinetOrgId: string,
    userIds: string[],
  ): Promise<CabinetMemberRecord[]> {
    if (userIds.length === 0) return [];
    const result = await dynamoClient.send(
      new BatchGetItemCommand({
        RequestItems: {
          [config.TABLE_NAME]: {
            Keys: userIds.map((userId) => ({
              PK: { S: KeyFactory.orgKey(cabinetOrgId) },
              SK: { S: KeyFactory.orgUserAccessSK(userId) },
            })),
            ConsistentRead: true,
          },
        },
      }),
    );
    return (result.Responses?.[config.TABLE_NAME] ?? [])
      .map(toMemberRecord)
      .filter((item): item is CabinetMemberRecord => Boolean(item));
  }

  static async replaceAssignments(input: {
    cabinetOrgId: string;
    userId: string;
    additions: string[];
    removals: string[];
    actorUserId: string;
    now: string;
  }): Promise<void> {
    const transactItems: TransactWriteItem[] = [
      ...input.additions.map((dossierOrgId) =>
        putIfAbsent({
          PK: KeyFactory.cabinetPK(input.cabinetOrgId),
          SK: KeyFactory.cabinetMemberDossierAssignmentSK(
            input.userId,
            dossierOrgId,
          ),
          entityType: "CABINET_DOSSIER_ASSIGNMENT",
          cabinetOrgId: input.cabinetOrgId,
          userId: input.userId,
          dossierOrgId,
          assignedBy: input.actorUserId,
          assignedAt: input.now,
          GSI1PK: KeyFactory.cabinetDossierAssignmentsGSI_PK(
            input.cabinetOrgId,
            dossierOrgId,
          ),
          GSI1SK: KeyFactory.cabinetDossierAssignmentsGSI_SK(input.userId),
        }),
      ),
      ...input.removals.map(
        (dossierOrgId): TransactWriteItem => ({
          Delete: {
            TableName: config.TABLE_NAME,
            Key: marshall({
              PK: KeyFactory.cabinetPK(input.cabinetOrgId),
              SK: KeyFactory.cabinetMemberDossierAssignmentSK(
                input.userId,
                dossierOrgId,
              ),
            }),
            ConditionExpression: "attribute_exists(PK) AND attribute_exists(SK)",
          },
        }),
      ),
    ];
    if (transactItems.length === 0) return;
    await dynamoClient.send(
      new TransactWriteItemsCommand({ TransactItems: transactItems }),
    );
  }

  static async acceptInvitation(input: {
    invitation: CabinetInvitationRecord;
    userId: string;
    displayName?: string;
    email: string;
    organization: OrganizationRecord;
    now: string;
  }): Promise<void> {
    const invitation = input.invitation;
    const accessItem = {
      PK: KeyFactory.orgKey(invitation.cabinetOrgId),
      SK: KeyFactory.orgUserAccessSK(input.userId),
      entityType: "USER_ORG_ACCESS",
      orgId: invitation.cabinetOrgId,
      userId: input.userId,
      role: "MEMBER",
      cabinetRole: invitation.role,
      status: "ACTIVE",
      accessSource: "DIRECT",
      cabinetId: invitation.cabinetId,
      displayName: input.organization.name,
      memberDisplayName: input.displayName,
      email: input.email,
      workspaceType: "ACCOUNTING_FIRM",
      country: input.organization.country,
      accountingFramework: input.organization.accountingFramework,
      joinedAt: input.now,
      invitedBy: invitation.invitedBy,
      createdAt: input.now,
      updatedAt: input.now,
      updatedBy: invitation.invitedBy,
      GSI6PK: KeyFactory.userWorkspacesPK(input.userId),
      GSI6SK: KeyFactory.userWorkspaceSK("ACTIVE", invitation.cabinetOrgId),
    };
    const assignmentItems = invitation.initialDossierOrgIds.map((dossierOrgId) =>
      putIfAbsent({
        PK: KeyFactory.cabinetPK(invitation.cabinetOrgId),
        SK: KeyFactory.cabinetMemberDossierAssignmentSK(
          input.userId,
          dossierOrgId,
        ),
        entityType: "CABINET_DOSSIER_ASSIGNMENT",
        cabinetOrgId: invitation.cabinetOrgId,
        userId: input.userId,
        dossierOrgId,
        assignedBy: invitation.invitedBy,
        assignedAt: input.now,
        GSI1PK: KeyFactory.cabinetDossierAssignmentsGSI_PK(
          invitation.cabinetOrgId,
          dossierOrgId,
        ),
        GSI1SK: KeyFactory.cabinetDossierAssignmentsGSI_SK(input.userId),
      }),
    );

    await dynamoClient.send(
      new TransactWriteItemsCommand({
        TransactItems: [
          putIfAbsent(accessItem),
          {
            Update: {
              TableName: config.TABLE_NAME,
              Key: marshall({
                PK: KeyFactory.cabinetPK(invitation.cabinetOrgId),
                SK: KeyFactory.cabinetInvitationSK(invitation.invitationId),
              }),
              ConditionExpression:
                "#status = :pending AND tokenHash = :tokenHash AND expiresAt = :expiresAt",
              UpdateExpression:
                "SET #status = :accepted, acceptedAt = :now, acceptedByUserId = :userId, updatedAt = :now, GSI1SK = :gsi1sk",
              ExpressionAttributeNames: { "#status": "status" },
              ExpressionAttributeValues: marshall({
                ":pending": "PENDING",
                ":accepted": "ACCEPTED",
                ":tokenHash": invitation.tokenHash,
                ":expiresAt": invitation.expiresAt,
                ":now": input.now,
                ":userId": input.userId,
                ":gsi1sk": KeyFactory.cabinetInvitationsGSI_SK(
                  "ACCEPTED",
                  invitation.createdAt,
                  invitation.invitationId,
                ),
              }),
            },
          },
          {
            Delete: {
              TableName: config.TABLE_NAME,
              Key: marshall({
                PK: KeyFactory.cabinetPK(invitation.cabinetOrgId),
                SK: KeyFactory.cabinetInvitationEmailLockSK(
                  invitation.normalizedEmail,
                ),
              }),
              ConditionExpression: "invitationId = :invitationId",
              ExpressionAttributeValues: marshall({
                ":invitationId": invitation.invitationId,
              }),
            },
          },
          {
            Delete: {
              TableName: config.TABLE_NAME,
              Key: marshall({
                PK: KeyFactory.invitationTokenPK(invitation.tokenHash),
                SK: KeyFactory.invitationTokenSK(),
              }),
              ConditionExpression: "invitationId = :invitationId",
              ExpressionAttributeValues: marshall({
                ":invitationId": invitation.invitationId,
              }),
            },
          },
          ...assignmentItems,
        ],
      }),
    );
  }
}
