import {
  AttributeValue,
  BatchGetItemCommand,
  GetItemCommand,
  TransactWriteItemsCommand,
  UpdateItemCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { AppError } from "../app-error";
import { config, dynamoClient } from "../dynamo-client";
import { KeyFactory } from "../key-builder";

export interface UserProfileRecord {
  userId: string;
  email: string;
  normalizedEmail: string;
  emailVerified: boolean;
  givenName?: string;
  familyName?: string;
  displayName: string;
  avatarUrl?: string;
  createdAt: string;
  updatedAt: string;
  lastSyncedFromIdentityAt: string;
}

export interface UserEmailLookupRecord {
  normalizedEmail: string;
  userId: string;
  createdAt: string;
  updatedAt: string;
}

function profileFromItem(
  item?: Record<string, AttributeValue>,
): UserProfileRecord | undefined {
  if (!item) return undefined;
  const value = unmarshall(item);
  if (
    value.entityType !== "USER_PROFILE" ||
    typeof value.userId !== "string" ||
    typeof value.email !== "string" ||
    typeof value.normalizedEmail !== "string" ||
    value.emailVerified !== true ||
    typeof value.displayName !== "string" ||
    typeof value.createdAt !== "string" ||
    typeof value.updatedAt !== "string" ||
    typeof value.lastSyncedFromIdentityAt !== "string"
  ) {
    return undefined;
  }
  return {
    userId: value.userId,
    email: value.email,
    normalizedEmail: value.normalizedEmail,
    emailVerified: true,
    givenName:
      typeof value.givenName === "string" ? value.givenName : undefined,
    familyName:
      typeof value.familyName === "string" ? value.familyName : undefined,
    displayName: value.displayName,
    avatarUrl:
      typeof value.avatarUrl === "string" ? value.avatarUrl : undefined,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    lastSyncedFromIdentityAt: value.lastSyncedFromIdentityAt,
  };
}

function lookupFromItem(
  item?: Record<string, AttributeValue>,
): UserEmailLookupRecord | undefined {
  if (!item) return undefined;
  const value = unmarshall(item);
  if (
    value.entityType !== "USER_EMAIL_LOOKUP" ||
    typeof value.normalizedEmail !== "string" ||
    typeof value.userId !== "string" ||
    typeof value.createdAt !== "string" ||
    typeof value.updatedAt !== "string"
  ) {
    return undefined;
  }
  return value as UserEmailLookupRecord;
}

function profileItem(profile: UserProfileRecord): Record<string, unknown> {
  return {
    PK: KeyFactory.userProfilePK(profile.userId),
    SK: KeyFactory.userProfileSK(),
    entityType: "USER_PROFILE",
    ...profile,
  };
}

function lookupItem(profile: UserProfileRecord): Record<string, unknown> {
  return {
    PK: KeyFactory.userEmailLookupPK(profile.normalizedEmail),
    SK: KeyFactory.userEmailLookupSK(),
    entityType: "USER_EMAIL_LOOKUP",
    normalizedEmail: profile.normalizedEmail,
    userId: profile.userId,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
  };
}

export class UserProfileRepository {
  static async get(userId: string): Promise<UserProfileRecord | undefined> {
    const result = await dynamoClient.send(
      new GetItemCommand({
        TableName: config.TABLE_NAME,
        Key: marshall({
          PK: KeyFactory.userProfilePK(userId),
          SK: KeyFactory.userProfileSK(),
        }),
        ConsistentRead: true,
      }),
    );
    return profileFromItem(result.Item);
  }

  static async resolveByEmail(
    normalizedEmail: string,
  ): Promise<UserEmailLookupRecord | undefined> {
    const result = await dynamoClient.send(
      new GetItemCommand({
        TableName: config.TABLE_NAME,
        Key: marshall({
          PK: KeyFactory.userEmailLookupPK(normalizedEmail),
          SK: KeyFactory.userEmailLookupSK(),
        }),
        ConsistentRead: true,
      }),
    );
    return lookupFromItem(result.Item);
  }

  static async batchGet(
    userIds: string[],
    requireComplete = false,
  ): Promise<Map<string, UserProfileRecord>> {
    const profiles = new Map<string, UserProfileRecord>();
    const uniqueIds = [...new Set(userIds)];
    for (let offset = 0; offset < uniqueIds.length; offset += 100) {
      let keys = uniqueIds.slice(offset, offset + 100).map((userId) =>
        marshall({
          PK: KeyFactory.userProfilePK(userId),
          SK: KeyFactory.userProfileSK(),
        }),
      );
      for (let attempt = 0; keys.length > 0 && attempt < 3; attempt += 1) {
        const result = await dynamoClient.send(
          new BatchGetItemCommand({
            RequestItems: {
              [config.TABLE_NAME]: { Keys: keys, ConsistentRead: true },
            },
          }),
        );
        for (const item of result.Responses?.[config.TABLE_NAME] ?? []) {
          const profile = profileFromItem(item);
          if (profile) profiles.set(profile.userId, profile);
        }
        keys = result.UnprocessedKeys?.[config.TABLE_NAME]?.Keys ?? [];
      }
      if (requireComplete && keys.length)
        throw new AppError(503, "ERROR_INTERNAL_SERVER");
    }
    return profiles;
  }

  static async create(profile: UserProfileRecord): Promise<void> {
    await dynamoClient.send(
      new TransactWriteItemsCommand({
        TransactItems: [profileItem(profile), lookupItem(profile)].map(
          (item) => ({
            Put: {
              TableName: config.TABLE_NAME,
              Item: marshall(item, { removeUndefinedValues: true }),
              ConditionExpression:
                "attribute_not_exists(PK) AND attribute_not_exists(SK)",
            },
          }),
        ),
      }),
    );
  }

  static async update(profile: UserProfileRecord): Promise<void> {
    await dynamoClient.send(
      new UpdateItemCommand({
        TableName: config.TABLE_NAME,
        Key: marshall({
          PK: KeyFactory.userProfilePK(profile.userId),
          SK: KeyFactory.userProfileSK(),
        }),
        ConditionExpression:
          "entityType = :entityType AND normalizedEmail = :email",
        UpdateExpression:
          "SET email = :displayEmail, emailVerified = :verified, givenName = :givenName, familyName = :familyName, displayName = :displayName, avatarUrl = :avatarUrl, updatedAt = :now, lastSyncedFromIdentityAt = :now",
        ExpressionAttributeValues: marshall(
          {
            ":entityType": "USER_PROFILE",
            ":email": profile.normalizedEmail,
            ":displayEmail": profile.email,
            ":verified": true,
            ":givenName": profile.givenName ?? "",
            ":familyName": profile.familyName ?? "",
            ":displayName": profile.displayName,
            ":avatarUrl": profile.avatarUrl ?? "",
            ":now": profile.updatedAt,
          },
          { removeUndefinedValues: true },
        ),
      }),
    );
  }

  static async changeEmail(
    previous: UserProfileRecord,
    profile: UserProfileRecord,
  ): Promise<void> {
    await dynamoClient.send(
      new TransactWriteItemsCommand({
        TransactItems: [
          {
            Put: {
              TableName: config.TABLE_NAME,
              Item: marshall(lookupItem(profile)),
              ConditionExpression:
                "attribute_not_exists(PK) AND attribute_not_exists(SK)",
            },
          },
          {
            Put: {
              TableName: config.TABLE_NAME,
              Item: marshall(profileItem(profile), {
                removeUndefinedValues: true,
              }),
              ConditionExpression: "normalizedEmail = :previousEmail",
              ExpressionAttributeValues: marshall({
                ":previousEmail": previous.normalizedEmail,
              }),
            },
          },
          {
            Delete: {
              TableName: config.TABLE_NAME,
              Key: marshall({
                PK: KeyFactory.userEmailLookupPK(previous.normalizedEmail),
                SK: KeyFactory.userEmailLookupSK(),
              }),
              ConditionExpression: "userId = :userId",
              ExpressionAttributeValues: marshall({
                ":userId": profile.userId,
              }),
            },
          },
        ],
      }),
    );
  }
}
