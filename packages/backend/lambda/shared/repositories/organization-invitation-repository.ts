import {
  GetItemCommand,
  TransactWriteItemsCommand,
  type TransactWriteItem,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { z } from "zod";
import { OrganizationInvitationStatusSchema } from "@liass-ohada/shared/shared";
import { config, dynamoClient } from "../dynamo-client";
import { KeyFactory as K } from "../key-builder";
import { AppError } from "../app-error";

const keys = { PK: z.string(), SK: z.string() };
export const OrganizationInvitationEntitySchema = z
  .object({
    ...keys,
    entityType: z.literal("ORGANIZATION_INVITATION"),
    orgId: z.string().min(1),
    invitationId: z.uuid(),
    email: z.email(),
    status: OrganizationInvitationStatusSchema,
    tokenHash: z.string().regex(/^[a-f0-9]{64}$/),
    invitedBy: z.string().min(1),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
    acceptedAt: z.iso.datetime().optional(),
    acceptedByUserId: z.string().optional(),
  })
  .strict();
export type OrganizationInvitationEntity = z.infer<
  typeof OrganizationInvitationEntitySchema
>;
const LockSchema = z
  .object({
    ...keys,
    entityType: z.literal("ORGANIZATION_INVITATION_EMAIL_LOCK"),
    orgId: z.string(),
    email: z.email(),
    invitationId: z.uuid(),
    expiresAt: z.iso.datetime(),
  })
  .strict();
const LookupSchema = z
  .object({
    ...keys,
    entityType: z.literal("ORGANIZATION_INVITATION_TOKEN_LOOKUP"),
    orgId: z.string(),
    invitationId: z.uuid(),
    tokenHash: z.string(),
  })
  .strict();
const CommandSchema = z
  .object({
    ...keys,
    entityType: z.literal("ORGANIZATION_INVITATION_COMMAND"),
    orgId: z.string(),
    actorUserId: z.string(),
    email: z.email(),
    invitationId: z.uuid(),
    createdAt: z.iso.datetime(),
  })
  .strict();
const AuditSchema = z
  .object({
    ...keys,
    entityType: z.literal("ORGANIZATION_INVITATION_AUDIT"),
    orgId: z.string(),
    actorUserId: z.string(),
    invitationId: z.uuid(),
    email: z.email(),
    action: z.enum([
      "CREATE_ORGANIZATION_INVITATION",
      "ACCEPT_ORGANIZATION_INVITATION",
    ]),
    before: z.union([z.literal("PENDING"), z.null()]),
    after: z.enum(["PENDING", "ACCEPTED"]),
    createdAt: z.iso.datetime(),
    targetUserId: z.string().optional(),
    membershipCreated: z.literal(true).optional(),
  })
  .strict();
const table = () => config.PLATFORM_TABLE_NAME;
const absent = "attribute_not_exists(PK) AND attribute_not_exists(SK)";
const put = (item: Record<string, unknown>): TransactWriteItem => ({
  Put: {
    TableName: table(),
    Item: marshall(item, { removeUndefinedValues: true }),
    ConditionExpression: absent,
  },
});
function orgGuard(orgId: string): TransactWriteItem {
  return {
    ConditionCheck: {
      TableName: table(),
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
  };
}
function audit(
  invite: OrganizationInvitationEntity,
  actor: string,
  now: string,
  accepting = false,
) {
  const action = accepting
    ? "ACCEPT_ORGANIZATION_INVITATION"
    : "CREATE_ORGANIZATION_INVITATION";
  return put(
    AuditSchema.parse({
      PK: invite.PK,
      SK: K.organizationInvitationAuditSK(now, invite.invitationId, action),
      entityType: "ORGANIZATION_INVITATION_AUDIT",
      orgId: invite.orgId,
      invitationId: invite.invitationId,
      email: invite.email,
      actorUserId: actor,
      action,
      before: accepting ? "PENDING" : null,
      after: accepting ? "ACCEPTED" : "PENDING",
      createdAt: now,
      ...(accepting ? { targetUserId: actor, membershipCreated: true } : {}),
    }),
  );
}
export class OrganizationInvitationRepository {
  private static async read(PK: string, SK: string) {
    const response = await dynamoClient.send(
      new GetItemCommand({
        TableName: table(),
        Key: marshall({ PK, SK }),
        ConsistentRead: true,
      }),
    );
    if (!response.Item) return undefined;
    const row = unmarshall(response.Item);
    if (row.PK !== PK || row.SK !== SK)
      throw new AppError(500, "ERROR_INTERNAL_SERVER");
    return row;
  }
  static async organization(orgId: string) {
    const row = await this.read(K.orgKey(orgId), K.organizationSK());
    if (
      !row ||
      row.entityType !== "ORGANIZATION" ||
      row.orgId !== orgId ||
      row.workspaceType !== "COMPANY" ||
      row.status !== "ACTIVE"
    )
      throw new AppError(403, "ERROR_ORG_ACCESS_DENIED");
    return row;
  }
  static async member(orgId: string, userId: string) {
    const row = await this.read(K.orgKey(orgId), K.orgUserAccessSK(userId));
    if (
      row &&
      (row.entityType !== "USER_ORG_ACCESS" ||
        row.orgId !== orgId ||
        row.userId !== userId)
    )
      throw new AppError(403, "ERROR_ORG_ACCESS_DENIED");
    return row;
  }
  static async invitation(orgId: string, invitationId: string) {
    const row = await this.read(
      K.orgKey(orgId),
      K.organizationInvitationSK(invitationId),
    );
    if (!row) return undefined;
    const parsed = OrganizationInvitationEntitySchema.parse(row);
    if (parsed.orgId !== orgId || parsed.invitationId !== invitationId)
      throw new AppError(500, "ERROR_INTERNAL_SERVER");
    return parsed;
  }
  static async lock(orgId: string, email: string) {
    const row = await this.read(
      K.orgKey(orgId),
      K.organizationInvitationEmailLockSK(email),
    );
    if (!row) return undefined;
    const lock = LockSchema.parse(row);
    if (lock.orgId !== orgId || lock.email !== email)
      throw new AppError(500, "ERROR_INTERNAL_SERVER");
    return lock;
  }
  static async lookup(tokenHash: string) {
    const row = await this.read(
      K.invitationTokenPK(tokenHash),
      K.invitationTokenSK(),
    );
    // The token namespace is shared; a Cabinet token must never enter COMPANY acceptance.
    const parsed = LookupSchema.safeParse(row);
    if (!parsed.success || parsed.data.tokenHash !== tokenHash)
      throw new AppError(404, "ORGANIZATION_INVITATION_INVALID");
    return parsed.data;
  }
  static async replay(
    orgId: string,
    actor: string,
    requestId: string,
    email: string,
  ) {
    const row = await this.read(
      K.userProfilePK(actor),
      K.organizationInvitationCommandSK(requestId),
    );
    if (!row) return undefined;
    const command = CommandSchema.parse(row);
    if (
      command.orgId !== orgId ||
      command.actorUserId !== actor ||
      command.email !== email
    )
      throw new AppError(409, "ORGANIZATION_INVITATION_IDEMPOTENCY_CONFLICT");
    return this.invitation(orgId, command.invitationId);
  }
  static async create(
    invite: OrganizationInvitationEntity,
    requestId: string,
    knownUserId?: string,
    previous?: OrganizationInvitationEntity,
  ) {
    const PK = invite.PK;
    const actions: TransactWriteItem[] = [
      orgGuard(invite.orgId),
      {
        ConditionCheck: {
          TableName: table(),
          Key: marshall({ PK, SK: K.orgUserAccessSK(invite.invitedBy) }),
          ConditionExpression:
            "entityType = :type AND orgId = :org AND userId = :actor AND #status = :active AND #role = :owner AND workspaceType = :company AND (attribute_not_exists(accessSource) OR accessSource = :direct)",
          ExpressionAttributeNames: { "#status": "status", "#role": "role" },
          ExpressionAttributeValues: marshall({
            ":type": "USER_ORG_ACCESS",
            ":org": invite.orgId,
            ":actor": invite.invitedBy,
            ":active": "ACTIVE",
            ":owner": "OWNER",
            ":company": "COMPANY",
            ":direct": "DIRECT",
          }),
        },
      },
      {
        ConditionCheck: {
          TableName: table(),
          Key: marshall({
            PK: K.userEmailLookupPK(invite.email),
            SK: K.userEmailLookupSK(),
          }),
          ConditionExpression: knownUserId
            ? "entityType = :type AND normalizedEmail = :email AND userId = :user"
            : absent,
          ...(knownUserId
            ? {
                ExpressionAttributeValues: marshall({
                  ":type": "USER_EMAIL_LOOKUP",
                  ":email": invite.email,
                  ":user": knownUserId,
                }),
              }
            : {}),
        },
      },
    ];
    if (knownUserId)
      actions.push(
        {
          ConditionCheck: {
            TableName: table(),
            Key: marshall({
              PK: K.userProfilePK(knownUserId),
              SK: K.userProfileSK(),
            }),
            ConditionExpression:
              "entityType = :type AND userId = :user AND normalizedEmail = :email AND emailVerified = :verified",
            ExpressionAttributeValues: marshall({
              ":type": "USER_PROFILE",
              ":user": knownUserId,
              ":email": invite.email,
              ":verified": true,
            }),
          },
        },
        {
          ConditionCheck: {
            TableName: table(),
            Key: marshall({ PK, SK: K.orgUserAccessSK(knownUserId) }),
            ConditionExpression: absent,
          },
        },
      );
    actions.push(put(OrganizationInvitationEntitySchema.parse(invite)));
    const lock = LockSchema.parse({
      PK,
      SK: K.organizationInvitationEmailLockSK(invite.email),
      entityType: "ORGANIZATION_INVITATION_EMAIL_LOCK",
      orgId: invite.orgId,
      email: invite.email,
      invitationId: invite.invitationId,
      expiresAt: invite.expiresAt,
    });
    actions.push({
      Put: {
        TableName: table(),
        Item: marshall(lock),
        ConditionExpression: previous
          ? "invitationId = :previous AND expiresAt <= :now"
          : absent,
        ...(previous
          ? {
              ExpressionAttributeValues: marshall({
                ":previous": previous.invitationId,
                ":now": invite.createdAt,
              }),
            }
          : {}),
      },
    });
    if (previous)
      actions.push({
        Update: {
          TableName: table(),
          Key: marshall({ PK, SK: previous.SK }),
          ConditionExpression: "#status = :pending AND expiresAt <= :now",
          UpdateExpression: "SET #status = :expired, updatedAt = :now",
          ExpressionAttributeNames: { "#status": "status" },
          ExpressionAttributeValues: marshall({
            ":pending": "PENDING",
            ":expired": "EXPIRED",
            ":now": invite.createdAt,
          }),
        },
      });
    actions.push(
      put(
        LookupSchema.parse({
          PK: K.invitationTokenPK(invite.tokenHash),
          SK: K.invitationTokenSK(),
          entityType: "ORGANIZATION_INVITATION_TOKEN_LOOKUP",
          orgId: invite.orgId,
          invitationId: invite.invitationId,
          tokenHash: invite.tokenHash,
        }),
      ),
      put(
        CommandSchema.parse({
          PK: K.userProfilePK(invite.invitedBy),
          SK: K.organizationInvitationCommandSK(requestId),
          entityType: "ORGANIZATION_INVITATION_COMMAND",
          orgId: invite.orgId,
          actorUserId: invite.invitedBy,
          email: invite.email,
          invitationId: invite.invitationId,
          createdAt: invite.createdAt,
        }),
      ),
      audit(invite, invite.invitedBy, invite.createdAt),
    );
    await dynamoClient.send(
      new TransactWriteItemsCommand({ TransactItems: actions }),
    );
  }
  static async accept(
    invite: OrganizationInvitationEntity,
    userId: string,
    organization: Record<string, unknown>,
    now: string,
  ) {
    const PK = invite.PK;
    const membership = {
      PK,
      SK: K.orgUserAccessSK(userId),
      entityType: "USER_ORG_ACCESS",
      orgId: invite.orgId,
      userId,
      role: "MEMBER",
      status: "ACTIVE",
      accessSource: "DIRECT",
      workspaceType: "COMPANY",
      displayName: organization.name ?? organization.displayName,
      country: organization.country,
      accountingFramework: organization.accountingFramework,
      joinedAt: now,
      invitedBy: invite.invitedBy,
      createdAt: now,
      updatedAt: now,
      updatedBy: userId,
      GSI6PK: K.userWorkspacesPK(userId),
      GSI6SK: K.userWorkspaceSK("ACTIVE", invite.orgId),
    };
    await dynamoClient.send(
      new TransactWriteItemsCommand({
        TransactItems: [
          orgGuard(invite.orgId),
          put(membership),
          {
            ConditionCheck: {
              TableName: table(),
              Key: marshall({
                PK: K.userProfilePK(userId),
                SK: K.userProfileSK(),
              }),
              ConditionExpression:
                "entityType = :type AND userId = :user AND normalizedEmail = :email AND emailVerified = :verified",
              ExpressionAttributeValues: marshall({
                ":type": "USER_PROFILE",
                ":user": userId,
                ":email": invite.email,
                ":verified": true,
              }),
            },
          },
          {
            ConditionCheck: {
              TableName: table(),
              Key: marshall({
                PK: K.userEmailLookupPK(invite.email),
                SK: K.userEmailLookupSK(),
              }),
              ConditionExpression:
                "entityType = :type AND userId = :user AND normalizedEmail = :email",
              ExpressionAttributeValues: marshall({
                ":type": "USER_EMAIL_LOOKUP",
                ":user": userId,
                ":email": invite.email,
              }),
            },
          },
          {
            Update: {
              TableName: table(),
              Key: marshall({ PK, SK: invite.SK }),
              ConditionExpression:
                "entityType = :type AND orgId = :org AND #status = :pending AND tokenHash = :hash AND expiresAt = :expires AND expiresAt > :now",
              UpdateExpression:
                "SET #status = :accepted, acceptedAt = :now, acceptedByUserId = :user, updatedAt = :now",
              ExpressionAttributeNames: { "#status": "status" },
              ExpressionAttributeValues: marshall({
                ":type": "ORGANIZATION_INVITATION",
                ":org": invite.orgId,
                ":pending": "PENDING",
                ":accepted": "ACCEPTED",
                ":hash": invite.tokenHash,
                ":expires": invite.expiresAt,
                ":now": now,
                ":user": userId,
              }),
            },
          },
          {
            Delete: {
              TableName: table(),
              Key: marshall({
                PK,
                SK: K.organizationInvitationEmailLockSK(invite.email),
              }),
              ConditionExpression: "invitationId = :id",
              ExpressionAttributeValues: marshall({
                ":id": invite.invitationId,
              }),
            },
          },
          // Retain the hashed lookup as a receipt for same-user replay, never as a second membership grant.
          audit(invite, userId, now, true),
        ],
      }),
    );
  }
}
