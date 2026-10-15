import { z } from "zod";
import { GetItemCommand, TransactWriteItem } from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import {
  ProductRolesSchema,
  RestaurantsRole,
} from "@liass-ohada/shared/shared";
import { AppError } from "../app-error";
import { config, dynamoClient } from "../dynamo-client";
import { KeyFactory as K } from "../key-builder";
import { UserProfileRepository } from "../repositories/user-profile-repository";

export interface RestaurantStaffIdentity {
  userId: string;
  active: boolean;
  restaurantRole: RestaurantsRole | null;
  displayName: string | null;
  membershipSource?: string;
}
/** Platform-owned read/check boundary. Restaurants never reads identity repositories or keys. */
export class RestaurantStaffIdentityService {
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
    const row = unmarshall(result.Item);
    if (
      row.entityType !== "USER_ORG_ACCESS" ||
      row.orgId !== orgId ||
      row.userId !== userId
    )
      return null;
    const roles = ProductRolesSchema.safeParse(row.productRoles);
    const profile = await UserProfileRepository.get(userId);
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
        (row.accessSource === undefined ||
          typeof row.accessSource === "string") &&
        row.accessSource !== "CABINET",
      membershipSource: row.accessSource,
      restaurantRole: roles.success ? (roles.data.RESTAURANTS ?? null) : null,
      displayName: safe ? name : null,
    };
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
