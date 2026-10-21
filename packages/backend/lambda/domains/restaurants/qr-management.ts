import { createHash, randomBytes, randomUUID } from "crypto";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import {
  GetItemCommand,
  TransactWriteItemsCommand,
  TransactWriteItem,
} from "@aws-sdk/client-dynamodb";
import {
  ManageTableQrRequestSchema,
  ManagedTableQrResponseSchema,
} from "@liass-ohada/shared/restaurants";
import { KeyFactory as K } from "@/lambda/shared/key-builder";
import { dynamoClient } from "@/lambda/shared/dynamo-client";
import { AppError } from "@/lambda/shared/app-error";
import { RestaurantStaffIdentityService as Identity } from "@/lambda/shared/services/restaurant-staff-identity-service";
import { RestaurantsRepository as Config } from "./restaurant-repository";
import { RestaurantsService } from "./restaurant-service";
import { restaurantsTableName } from "./restaurant-storage";
import { transactionFingerprint } from "./transaction-repository";
import { z } from "zod";

const Evidence = z.object({
  entityType: z.literal("RESTAURANT_QR_COMMAND"),
  orgId: z.string(),
  actorId: z.string(),
  fingerprint: z.string(),
  result: ManagedTableQrResponseSchema,
});
export class QrManagement {
  static async read(
    orgId: string,
    outletId: string,
    areaId: string,
    tableId: string,
  ) {
    await RestaurantsService.get(
      orgId,
      "table",
      { outletId, serviceAreaId: areaId },
      tableId,
    );
    const table = await Config.get(
      orgId,
      "table",
      { outletId, serviceAreaId: areaId },
      tableId,
    );
    if (!table) throw new AppError(404, "RESTAURANTS_NOT_FOUND");
    return ManagedTableQrResponseSchema.parse({
      status: table.qrRevoked ? "REVOKED" : "ACTIVE",
      version: table.data.version,
      ...(table.qrRevoked ? {} : { token: table.qrToken }),
    });
  }
  static async mutate(
    orgId: string,
    actorId: string,
    outletId: string,
    areaId: string,
    tableId: string,
    operation: "rotate" | "revoke",
    input: unknown,
  ) {
    const request = ManageTableQrRequestSchema.parse(input),
      TableName = restaurantsTableName();
    const actor = await Identity.get(orgId, actorId);
    if (!actor) throw new AppError(403, "DOMAIN_PERMISSION_REQUIRED");
    const accessChecks = Identity.writeChecks(orgId, actor);
    const owner = tableId,
      hash = transactionFingerprint([
        actorId,
        operation,
        areaId,
        request.clientRequestId,
      ]);
    const commandKey = {
      PK: K.restaurantTransactionCommandPK(
        orgId,
        outletId,
        `QR_${operation.toUpperCase()}`,
        owner,
        hash,
      ),
      SK: K.restaurantTransactionCommandSK(owner, hash),
    };
    const fingerprint = transactionFingerprint([
      actorId,
      orgId,
      outletId,
      areaId,
      tableId,
      operation,
      request,
    ]);
    const replay = async () => {
      const raw = await dynamoClient.send(
        new GetItemCommand({
          TableName,
          Key: marshall(commandKey),
          ConsistentRead: true,
        }),
      );
      if (!raw.Item) return undefined;
      const saved = Evidence.parse(unmarshall(raw.Item));
      if (
        saved.orgId !== orgId ||
        saved.actorId !== actorId ||
        saved.fingerprint !== fingerprint
      )
        throw new AppError(409, "RESTAURANTS_WRITE_CONFLICT");
      return saved.result;
    };
    const oldResult = await replay();
    if (oldResult) return oldResult;
    await RestaurantsService.get(
      orgId,
      "table",
      { outletId, serviceAreaId: areaId },
      tableId,
    );
    const current = await Config.get(
      orgId,
      "table",
      { outletId, serviceAreaId: areaId },
      tableId,
    );
    if (!current?.qrToken || current.data.version !== request.expectedVersion)
      throw new AppError(409, "RESTAURANTS_WRITE_CONFLICT");
    const root = await Config.get(orgId, "restaurant", {});
    if (!root) throw new AppError(404, "RESTAURANTS_NOT_FOUND");
    const now = new Date().toISOString(),
      commandId = randomUUID();
    const token =
      operation === "rotate"
        ? randomBytes(32).toString("base64url")
        : current.qrToken;
    const version = current.data.version + 1;
    const result = ManagedTableQrResponseSchema.parse({
      status: operation === "rotate" ? "ACTIVE" : "REVOKED",
      version,
      ...(operation === "rotate" ? { token } : {}),
    });
    const tableKey = {
      PK: K.orgKey(orgId),
      SK: K.restaurantTableSK(outletId, areaId, tableId),
    };
    const actions: TransactWriteItem[] = [
      ...accessChecks,
      {
        Put: {
          TableName,
          Item: marshall({
            ...tableKey,
            orgId,
            entityType: "RESTAURANT_TABLE",
            createFingerprint: current.createFingerprint,
            data: { ...current.data, version, updatedAt: now },
            qrToken: token,
            qrRevoked: operation === "revoke",
          }),
          ConditionExpression:
            "entityType = :type AND orgId = :org AND #data.#version = :version",
          ExpressionAttributeNames: { "#data": "data", "#version": "version" },
          ExpressionAttributeValues: marshall({
            ":type": "RESTAURANT_TABLE",
            ":org": orgId,
            ":version": request.expectedVersion,
          }),
        },
      },
    ];
    const lookupKey = (raw: string) => ({
      PK: K.restaurantQrPK(createHash("sha256").update(raw).digest("hex")),
      SK: K.restaurantQrSK(),
    });
    if (!current.qrRevoked)
      actions.push({
        Delete: {
          TableName,
          Key: marshall(lookupKey(current.qrToken)),
          ConditionExpression:
            "entityType = :type AND orgId = :org AND tableId = :id",
          ExpressionAttributeValues: marshall({
            ":type": "RESTAURANT_TABLE_QR",
            ":org": orgId,
            ":id": tableId,
          }),
        },
      });
    if (operation === "rotate")
      actions.push({
        Put: {
          TableName,
          Item: marshall({
            ...lookupKey(token),
            entityType: "RESTAURANT_TABLE_QR",
            orgId,
            restaurantId: root.data.id,
            outletId,
            serviceAreaId: areaId,
            tableId,
          }),
          ConditionExpression:
            "attribute_not_exists(PK) AND attribute_not_exists(SK)",
        },
      });
    const evidence = {
      commandId,
      actorId,
      action: `QR_${operation.toUpperCase()}`,
      targetId: tableId,
      committedAt: now,
      version,
      fromState: current.qrRevoked ? "REVOKED" : "ACTIVE",
      toState: result.status,
    };
    const add = (item: Record<string, unknown>) =>
      actions.push({
        Put: {
          TableName,
          Item: marshall(item),
          ConditionExpression:
            "attribute_not_exists(PK) AND attribute_not_exists(SK)",
        },
      });
    add({
      ...commandKey,
      entityType: "RESTAURANT_QR_COMMAND",
      orgId,
      actorId,
      fingerprint,
      result,
    });
    add({
      PK: K.restaurantOccupancyPK(orgId, outletId, tableId),
      SK: K.restaurantTransactionAuditSK(now, commandId),
      orgId,
      outletId,
      schemaVersion: 1,
      entityType: "RESTAURANT_TRANSACTION_AUDIT",
      data: evidence,
    });
    add({
      PK: K.restaurantTransactionHistoryPK(
        orgId,
        outletId,
        "ACT",
        now.slice(0, 10).replace(/-/g, ""),
      ),
      SK: K.restaurantTransactionLocatorSK(now, commandId),
      orgId,
      outletId,
      schemaVersion: 1,
      entityType: "RESTAURANT_TRANSACTION_ACTIVITY",
      data: evidence,
    });
    try {
      await dynamoClient.send(
        new TransactWriteItemsCommand({ TransactItems: actions }),
      );
    } catch (error) {
      const saved = await replay();
      if (saved) return saved;
      if (
        error instanceof Error &&
        [
          "TransactionCanceledException",
          "ConditionalCheckFailedException",
        ].includes(error.name)
      )
        throw new AppError(409, "RESTAURANTS_WRITE_CONFLICT");
      throw error;
    }
    return result;
  }
}
