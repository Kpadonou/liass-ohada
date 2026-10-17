import { z } from "zod";
import {
  BatchGetItemCommand,
  GetItemCommand,
  TransactWriteItem,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import {
  ProductRolesSchema,
  RestaurantsRole,
} from "@liass-ohada/shared/shared";
import { AppError } from "../app-error";
import { config, dynamoClient } from "../dynamo-client";
import { KeyFactory as K } from "../key-builder";
import {
  UserProfileRecord,
  UserProfileRepository,
} from "../repositories/user-profile-repository";
import { OrganizationMemberRepository } from "../repositories/organization-member-repository";

export interface RestaurantStaffIdentity {
  userId: string;
  active: boolean;
  restaurantRole: RestaurantsRole | null;
  displayName: string | null;
  membershipSource?: string;
}
/** Platform-owned read/check boundary. Restaurants never reads identity repositories or keys. */
export class RestaurantStaffIdentityService {
  /** Platform-owned organization precondition for staff activation/provisioning only. */
  static async staffProvisioningChecks(
    orgId: string,
  ): Promise<TransactWriteItem[]> {
    await OrganizationMemberRepository.requireActiveCompany(orgId);
    return [
      {
        ConditionCheck: {
          TableName: config.PLATFORM_TABLE_NAME,
          Key: marshall({ PK: K.orgKey(orgId), SK: K.organizationSK() }),
          ConditionExpression:
            "entityType = :type AND orgId = :org AND workspaceType = :company AND #status = :active",
          ExpressionAttributeNames: { "#status": "status" },
          ExpressionAttributeValues: marshall({
            ":type": "ORGANIZATION",
            ":org": orgId,
            ":company": "COMPANY",
            ":active": "ACTIVE",
          }),
        },
      },
    ];
  }
  static async get(
    orgId: string,
    userId: string,
  ): Promise<RestaurantStaffIdentity | null> {
    const result = await dynamoClient.send(
      new GetItemCommand({
        TableName: config.PLATFORM_TABLE_NAME,
        Key: marshall({ PK: K.orgKey(orgId), SK: K.orgUserAccessSK(userId) }),
        ConsistentRead: true,
      }),
    );
    if (!result.Item) return null;
    const profile = await UserProfileRepository.get(userId);
    return this.project(orgId, userId, unmarshall(result.Item), profile);
  }
  private static project(
    orgId: string,
    userId: string,
    row: Record<string, unknown>,
    profile?: UserProfileRecord,
  ): RestaurantStaffIdentity | null {
    if (
      row.entityType !== "USER_ORG_ACCESS" ||
      row.orgId !== orgId ||
      row.userId !== userId ||
      row.PK !== K.orgKey(orgId) ||
      row.SK !== K.orgUserAccessSK(userId)
    )
      return null;
    const roles = ProductRolesSchema.safeParse(row.productRoles);
    const name =
      profile?.userId === userId ? profile.displayName.trim() : undefined;
    // Canonical profiles can fall back to email. Never propagate that fallback to operations.
    const safe =
      name &&
      name.length <= 160 &&
      !name.includes("@") &&
      name !== userId &&
      !z.string().uuid().safeParse(name).success &&
      !/[\u0000-\u001f\u007f]/.test(name) &&
      name !== profile?.normalizedEmail;
    return {
      userId,
      active:
        row.status === "ACTIVE" &&
        row.workspaceType === "COMPANY" &&
        (row.accessSource === undefined || row.accessSource === "DIRECT"),
      membershipSource:
        typeof row.accessSource === "string" ? row.accessSource : undefined,
      restaurantRole: roles.success ? (roles.data.RESTAURANTS ?? null) : null,
      displayName: safe ? name : null,
    };
  }

  /** Bounded Platform-owned membership/profile join for operational read models. */
  static async batch(
    orgId: string,
    userIds: string[],
  ): Promise<Map<string, RestaurantStaffIdentity>> {
    const ids = [...new Set(userIds)];
    if (ids.length > 100)
      throw new AppError(400, "RESTAURANTS_TRANSACTION_LIMIT");
    if (!ids.length) return new Map();
    const table = config.PLATFORM_TABLE_NAME;
    const keyId = (key: Record<string, unknown>) =>
      JSON.stringify([key.PK, key.SK]);
    let pending = ids.map((userId) =>
      marshall({ PK: K.orgKey(orgId), SK: K.orgUserAccessSK(userId) }),
    );
    const rows = new Map<string, Record<string, unknown>>();
    for (let attempt = 0; pending.length && attempt < 3; attempt++) {
      const requested = new Set(pending.map((key) => keyId(unmarshall(key))));
      const response = await dynamoClient.send(
        new BatchGetItemCommand({
          RequestItems: { [table]: { Keys: pending, ConsistentRead: true } },
        }),
      );
      for (const raw of response.Responses?.[table] ?? []) {
        const row = unmarshall(raw);
        if (
          !requested.has(keyId(row)) ||
          typeof row.userId !== "string" ||
          rows.has(row.userId)
        )
          throw new AppError(409, "RESTAURANTS_TRANSACTION_INTEGRITY");
        rows.set(row.userId, row);
      }
      pending = response.UnprocessedKeys?.[table]?.Keys ?? [];
      if (pending.some((key) => !requested.has(keyId(unmarshall(key)))))
        throw new AppError(409, "RESTAURANTS_TRANSACTION_INTEGRITY");
    }
    if (pending.length) throw new AppError(503, "ERROR_INTERNAL_SERVER");
    const profiles = await UserProfileRepository.batchGet(ids, true);
    const result = new Map<string, RestaurantStaffIdentity>();
    for (const userId of ids) {
      const row = rows.get(userId);
      const value = row
        ? this.project(orgId, userId, row, profiles.get(userId))
        : null;
      if (value) result.set(userId, value);
    }
    return result;
  }

  /** Read-only Platform condition checks can participate in the caller's atomic business write. */
  static writeChecks(
    orgId: string,
    actor: RestaurantStaffIdentity,
    subject?: RestaurantStaffIdentity,
  ): TransactWriteItem[] {
    if (
      !actor.active ||
      !["OWNER", "MANAGER"].includes(actor.restaurantRole ?? "")
    )
      throw new AppError(403, "DOMAIN_PERMISSION_REQUIRED");
    if (subject && (!subject.active || !subject.restaurantRole))
      throw new AppError(403, "RESTAURANTS_STAFF_MEMBER_REQUIRED");
    return this.membershipChecks(orgId, actor, subject);
  }

  /** Role-neutral self discovery; no service/preparation authority is implied. */
  static outletSelfChecks(
    orgId: string,
    actor: RestaurantStaffIdentity,
  ): TransactWriteItem[] {
    if (
      !actor.active ||
      !["OWNER", "MANAGER", "WAITER", "KITCHEN"].includes(
        actor.restaurantRole ?? "",
      )
    )
      throw new AppError(403, "DOMAIN_PERMISSION_REQUIRED");
    return this.membershipChecks(orgId, actor);
  }

  /** Narrow service authorization guard; never grants staff administration. */
  static serviceChecks(
    orgId: string,
    actor: RestaurantStaffIdentity,
    preparation = false,
  ): TransactWriteItem[] {
    if (
      !actor.active ||
      ![
        "OWNER",
        "MANAGER",
        "WAITER",
        ...(preparation ? ["KITCHEN"] : []),
      ].includes(actor.restaurantRole ?? "")
    )
      throw new AppError(403, "DOMAIN_PERMISSION_REQUIRED");
    return this.membershipChecks(orgId, actor);
  }

  private static membershipChecks(
    orgId: string,
    actor: RestaurantStaffIdentity,
    subject?: RestaurantStaffIdentity,
  ): TransactWriteItem[] {
    const members = new Map(
      [...(subject ? [subject] : []), actor].map((member) => [
        member.userId,
        member,
      ]),
    );
    return [
      ...[...members.values()].map(
        (member): TransactWriteItem => ({
          ConditionCheck: {
            TableName: config.PLATFORM_TABLE_NAME,
            Key: marshall({
              PK: K.orgKey(orgId),
              SK: K.orgUserAccessSK(member.userId),
            }),
            ConditionExpression:
              "entityType = :type AND orgId = :org AND userId = :user AND #status = :active AND productRoles.RESTAURANTS = :role AND workspaceType = :workspace AND " +
              (member.membershipSource === undefined
                ? "attribute_not_exists(accessSource)"
                : "accessSource = :source"),
            ExpressionAttributeNames: { "#status": "status" },
            ExpressionAttributeValues: marshall({
              ":type": "USER_ORG_ACCESS",
              ":org": orgId,
              ":user": member.userId,
              ":active": "ACTIVE",
              ":role": member.restaurantRole,
              ":workspace": "COMPANY",
              ...(member.membershipSource === undefined
                ? {}
                : { ":source": member.membershipSource }),
            }),
          },
        }),
      ),
      {
        ConditionCheck: {
          TableName: config.PLATFORM_TABLE_NAME,
          Key: marshall({
            PK: K.orgKey(orgId),
            SK: K.productAccessSK("RESTAURANTS"),
          }),
          ConditionExpression:
            "entityType = :type AND orgId = :org AND productCode = :product AND #status = :active",
          ExpressionAttributeNames: { "#status": "status" },
          ExpressionAttributeValues: marshall({
            ":type": "PRODUCT_ACCESS",
            ":org": orgId,
            ":product": "RESTAURANTS",
            ":active": "ACTIVE",
          }),
        },
      },
    ];
  }
}
