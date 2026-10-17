import { randomUUID } from "crypto";
import { marshall } from "@aws-sdk/util-dynamodb";
import { TransactWriteItem } from "@aws-sdk/client-dynamodb";
import * as c from "@liass-ohada/shared/restaurants";
import { AppError } from "@/lambda/shared/app-error";
import { KeyFactory as K } from "@/lambda/shared/key-builder";
import { RestaurantServiceAccess } from "./service-access";
import { RestaurantsRepository } from "./restaurant-repository";
import { entityTypes } from "./restaurant-model";
import { restaurantsTableName } from "./restaurant-storage";
import {
  RestaurantTransactionsRepository as R,
  transactionFingerprint as fingerprint,
} from "./transaction-repository";
import { TransactionScope, TransactionRow } from "./transaction-model";

const fail = (code = "RESTAURANTS_TRANSACTION_STATE", status = 409): never => {
  throw new AppError(status, code);
};
const taskKey = (
  s: TransactionScope,
  orderId: string,
  itemId: string,
  fireId: string,
) => ({
  PK: K.restaurantOrderPK(s.orgId, s.outletId, orderId),
  SK: K.restaurantPreparationSK(itemId, fireId),
});
export class RestaurantPreparationService {
  static queueRow(s: TransactionScope, task: c.RestaurantPreparation) {
    const { orderId, itemId, fireId, stationId, state, queuedAt, version } =
      task;
    return R.row(
      s,
      {
        PK: K.restaurantWorkPK(s.orgId, s.outletId, stationId, state),
        SK: K.restaurantWorkSK(queuedAt, orderId, itemId, fireId),
      },
      "WORK",
      {
        orderId,
        itemId,
        fireId,
        stationId,
        state: c.PreparationLaneSchema.parse(state),
        queuedAt,
        version,
      },
    );
  }
  static creation(
    s: TransactionScope,
    line: c.RestaurantOrderItem,
    actorId: string,
  ) {
    const snap = line.snapshot;
    if (!snap?.stationId) return undefined;
    const task = c.RestaurantPreparationSchema.parse({
      orgId: s.orgId,
      outletId: s.outletId,
      schemaVersion: 1,
      orderId: line.orderId,
      itemId: line.itemId,
      submissionId: snap.submissionId,
      stationId: snap.stationId,
      stationVersion: snap.stationVersion,
      fireId: randomUUID(),
      generation: 1,
      name: snap.name,
      quantity: snap.quantity,
      notes: line.notes,
      state: "QUEUED",
      queuedAt: snap.acceptedAt,
      queuedBy: actorId,
      version: 1,
    });
    return {
      task,
      actions: [
        R.put(
          R.row(
            s,
            taskKey(s, task.orderId, task.itemId, task.fireId),
            "PREPARATION",
            task,
          ),
        ),
        R.put(this.queueRow(s, task)),
      ],
    };
  }
  static async task(
    s: TransactionScope,
    orderId: string,
    itemId: string,
    fireId: string,
  ) {
    const row = await R.get(
      s,
      taskKey(s, orderId, itemId, fireId),
      "PREPARATION",
    );
    if (!row || row.entityType !== "RESTAURANT_PREPARATION")
      return fail("RESTAURANTS_NOT_FOUND", 404);
    return row;
  }
  /** Used only by the existing management sale-cancellation transaction. */
  static async cancellation(
    s: TransactionScope,
    line: c.RestaurantOrderItem,
    actorId: string,
    reason: string,
    now: string,
  ) {
    if (!line.latestFireId)
      return { actions: [] as TransactWriteItem[], decrement: 0 };
    const row = await this.task(
      s,
      line.orderId,
      line.itemId,
      line.latestFireId,
    );
    if (
      row.data.submissionId !== line.snapshot?.submissionId ||
      row.data.stationId !== line.snapshot.stationId ||
      row.data.quantity !== line.snapshot.quantity
    )
      return fail("RESTAURANTS_TRANSACTION_INTEGRITY");
    if (["SERVED", "CANCELLED"].includes(row.data.state))
      return { actions: [] as TransactWriteItem[], decrement: 0 };
    const terminal: c.RestaurantPreparation = {
      ...row.data,
      state: "CANCELLED",
      version: row.data.version + 1,
      cancelledAt: now,
      cancelledBy: actorId,
      cancellationReason: reason,
    };
    const commandId = randomUUID();
    const evidence = {
      commandId,
      actorId,
      action: "CANCEL_PREPARATION_WITH_SALE",
      targetId: line.orderId,
      committedAt: now,
      version: terminal.version,
      fromState: row.data.state,
      toState: "CANCELLED",
      reason,
      preparation: {
        itemId: line.itemId,
        fireId: line.latestFireId,
        stationId: row.data.stationId,
        submissionId: row.data.submissionId,
      },
    };
    return {
      actions: [
        R.put(
          R.row(
            s,
            taskKey(s, line.orderId, line.itemId, line.latestFireId),
            "PREPARATION",
            terminal,
          ),
          row,
        ),
        R.remove(this.queueRow(s, row.data)),
        R.put(
          R.row(
            s,
            { PK: row.PK, SK: K.restaurantTransactionAuditSK(now, commandId) },
            "AUDIT",
            evidence,
          ),
        ),
        R.put(
          R.row(
            s,
            {
              PK: K.restaurantTransactionHistoryPK(
                s.orgId,
                s.outletId,
                "ACT",
                now.slice(0, 10).replace(/-/g, ""),
              ),
              SK: K.restaurantTransactionLocatorSK(now, commandId),
            },
            "ACTIVITY",
            evidence,
          ),
        ),
      ],
      decrement: 1,
    };
  }
  static async access(
    s: TransactionScope,
    actorId: string,
    action: "READ" | "START" | "READY" | "SERVE",
  ) {
    const access = await RestaurantServiceAccess.authorize(s, actorId, true);
    const allowed =
      action === "SERVE"
        ? ["OWNER", "MANAGER", "WAITER"]
        : ["OWNER", "MANAGER", "KITCHEN"];
    if (!allowed.includes(access.role ?? ""))
      return fail("DOMAIN_PERMISSION_REQUIRED", 403);
    const outlet = await RestaurantsRepository.get(
      s.orgId,
      "outlet",
      {},
      s.outletId,
    );
    if (!outlet?.data.isActive) return fail("DOMAIN_PERMISSION_REQUIRED", 403);
    access.actions.push({
      ConditionCheck: {
        TableName: restaurantsTableName(),
        Key: marshall({
          PK: K.orgKey(s.orgId),
          SK: K.restaurantOutletSK(s.outletId),
        }),
        ConditionExpression:
          "entityType = :type AND orgId = :org AND #data.#version = :version AND #data.#active = :active",
        ExpressionAttributeNames: {
          "#data": "data",
          "#version": "version",
          "#active": "isActive",
        },
        ExpressionAttributeValues: marshall({
          ":type": entityTypes.outlet,
          ":org": s.orgId,
          ":version": outlet.data.version,
          ":active": true,
        }),
      },
    });
    return access;
  }
  static async read(
    s: TransactionScope,
    actorId: string,
    input: unknown,
    ids: { orderId?: string; stationId?: string; state?: string },
  ) {
    await this.access(s, actorId, "READ");
    const page = c.RestaurantTransactionListRequestSchema.parse(input);
    if (ids.orderId) {
      const orderId = c.RestaurantIdSchema.parse(ids.orderId);
      const order = await R.get(
        s,
        {
          PK: K.restaurantOrderPK(s.orgId, s.outletId, orderId),
          SK: K.restaurantTransactionMetaSK(),
        },
        "ORDER",
      );
      if (!order) return fail("RESTAURANTS_NOT_FOUND", 404);
      const result = await R.query(
        s,
        order.PK,
        K.restaurantPreparationPrefix(),
        "PREPARATION",
        page,
      );
      return c.PreparationListResponseSchema.parse({
        items: result.rows.map((r) => r.data),
        nextCursor: result.nextCursor,
      });
    }
    const stationId = c.RestaurantIdSchema.parse(ids.stationId),
      state = c.PreparationLaneSchema.parse(ids.state);
    // Inactive stations retain accepted work; ownership is still mandatory.
    if (
      !(await RestaurantsRepository.get(
        s.orgId,
        "station",
        { outletId: s.outletId },
        stationId,
      ))
    )
      return fail("RESTAURANTS_NOT_FOUND", 404);
    const result = await R.query(
      s,
      K.restaurantWorkPK(s.orgId, s.outletId, stationId, state),
      "",
      "WORK",
      page,
    );
    const refs = result.rows.map(
      (r) =>
        r.data as Extract<
          TransactionRow,
          { entityType: "RESTAURANT_PREPARATION_WORK" }
        >["data"],
    );
    const rows = await R.batch(
      s,
      refs.map((r) => taskKey(s, r.orderId, r.itemId, r.fireId)),
      "PREPARATION",
    );
    const items = rows.map((row, i) => {
      if (!row) return fail("RESTAURANTS_TRANSACTION_INTEGRITY");
      const task = c.RestaurantPreparationSchema.parse(row.data),
        ref = refs[i];
      if (
        task.stationId !== stationId ||
        task.state !== state ||
        task.version !== ref.version ||
        task.queuedAt !== ref.queuedAt
      )
        return fail("RESTAURANTS_WRITE_CONFLICT");
      return task;
    });
    return c.PreparationListResponseSchema.parse({
      items,
      nextCursor: result.nextCursor,
    });
  }
  static async transition(
    s: TransactionScope,
    actorId: string,
    action: "START" | "READY" | "SERVE",
    input: unknown,
    ids: { orderId: string; itemId: string; fireId: string },
  ) {
    const req = c.PreparationTransitionRequestSchema.parse(input);
    Object.values(ids).forEach((id) => c.RestaurantIdSchema.parse(id));
    const access = await this.access(s, actorId, action);
    const { orderId, itemId, fireId } = ids;
    const command = `PREPARATION_${action}`,
      owner = orderId;
    const hash = fingerprint([
      s.orgId,
      s.outletId,
      command,
      owner,
      req.clientRequestId,
    ]);
    const key = {
      PK: K.restaurantTransactionCommandPK(
        s.orgId,
        s.outletId,
        command,
        owner,
        hash,
      ),
      SK: K.restaurantTransactionCommandSK(owner, hash),
    };
    const intent = fingerprint([actorId, command, ids, req]);
    const replay = async () => {
      const row = await R.get(s, key, "PREPARATION_COMMAND");
      if (!row) return undefined;
      if (
        !("fingerprint" in row.data) ||
        !("commandKind" in row.data) ||
        row.data.commandKind !== command ||
        row.data.ownerId !== owner ||
        row.data.lookupHash !== hash ||
        row.data.fingerprint !== intent ||
        !("result" in row.data)
      )
        return fail("RESTAURANTS_IDEMPOTENCY_CONFLICT");
      return c.PreparationResponseSchema.parse({ data: row.data.result });
    };
    const prior = await replay();
    if (prior) return prior;
    const row = await this.task(s, orderId, itemId, fireId);
    const order = await R.get(
      s,
      { PK: row.PK, SK: K.restaurantTransactionMetaSK() },
      "ORDER",
    );
    const line = await R.get(
      s,
      { PK: row.PK, SK: K.restaurantOrderItemSK(itemId) },
      "LINE",
    );
    if (!order || !line) return fail("RESTAURANTS_NOT_FOUND", 404);
    const o = c.RestaurantOrderSchema.parse(order.data),
      l = c.RestaurantOrderItemSchema.parse(line.data);
    if (
      o.status !== "SUBMITTED" ||
      l.status !== "ACCEPTED" ||
      l.latestFireId !== fireId ||
      l.snapshot?.submissionId !== row.data.submissionId ||
      l.snapshot.stationId !== row.data.stationId ||
      l.snapshot.quantity !== row.data.quantity
    )
      return fail();
    const from = {
      START: "QUEUED",
      READY: "IN_PROGRESS",
      SERVE: "READY",
    } as const;
    const to = {
      START: "IN_PROGRESS",
      READY: "READY",
      SERVE: "SERVED",
    } as const;
    if (row.data.version !== req.expectedVersion)
      return fail("RESTAURANTS_WRITE_CONFLICT");
    if (row.data.state !== from[action]) return fail();
    const now = new Date().toISOString(),
      commandId = randomUUID();
    const task: c.RestaurantPreparation = {
      ...row.data,
      state: to[action],
      version: row.data.version + 1,
      ...(action === "START"
        ? { startedAt: now, startedBy: actorId }
        : action === "READY"
          ? { readyAt: now, readyBy: actorId }
          : { servedAt: now, servedBy: actorId }),
    };
    const actions: TransactWriteItem[] = [
      ...access.actions,
      R.put(
        R.row(s, taskKey(s, orderId, itemId, fireId), "PREPARATION", task),
        row,
      ),
      R.remove(this.queueRow(s, row.data)),
      {
        ConditionCheck: {
          TableName: restaurantsTableName(),
          Key: marshall({ PK: line.PK, SK: line.SK }),
          ...R.conditions(line),
        },
      },
    ];
    if (action !== "SERVE") actions.push(R.put(this.queueRow(s, task)));
    if (action === "SERVE") {
      if (!o.outstandingWorkCount)
        return fail("RESTAURANTS_TRANSACTION_INTEGRITY");
      actions.push(
        R.put(
          R.row(s, { PK: order.PK, SK: order.SK }, "ORDER", {
            ...o,
            outstandingWorkCount: o.outstandingWorkCount - 1,
            version: o.version + 1,
          }),
          order,
        ),
      );
    } else
      actions.push({
        ConditionCheck: {
          TableName: restaurantsTableName(),
          Key: marshall({ PK: order.PK, SK: order.SK }),
          ...R.conditions(order),
        },
      });
    const evidence = {
      commandId,
      actorId,
      action: command,
      targetId: orderId,
      committedAt: now,
      version: task.version,
      fromState: row.data.state,
      toState: task.state,
      preparation: {
        itemId,
        fireId,
        stationId: task.stationId,
        submissionId: task.submissionId,
      },
    };
    actions.push(
      R.put(
        R.row(
          s,
          { PK: row.PK, SK: K.restaurantTransactionAuditSK(now, commandId) },
          "AUDIT",
          evidence,
        ),
      ),
      R.put(
        R.row(
          s,
          {
            PK: K.restaurantTransactionHistoryPK(
              s.orgId,
              s.outletId,
              "ACT",
              now.slice(0, 10).replace(/-/g, ""),
            ),
            SK: K.restaurantTransactionLocatorSK(now, commandId),
          },
          "ACTIVITY",
          evidence,
        ),
      ),
      R.put(
        R.row(s, key, "PREPARATION_COMMAND", {
          commandId,
          commandKind: command,
          ownerId: owner,
          lookupHash: hash,
          committedAt: now,
          fingerprint: intent,
          result: task,
        }),
      ),
    );
    try {
      await R.commit(actions);
    } catch (error) {
      // A concurrent winner may have committed this exact durable intent.
      await this.access(s, actorId, action);
      const winner = await replay();
      if (winner) return winner;
      if (
        error instanceof Error &&
        error.name === "TransactionCanceledException"
      )
        return fail("RESTAURANTS_WRITE_CONFLICT");
      throw error;
    }
    console.info("[RESTAURANTS_PREPARATION]", {
      action,
      orderId,
      itemId,
      fireId,
      result: "COMMITTED",
    });
    return c.PreparationResponseSchema.parse({ data: task });
  }
}
