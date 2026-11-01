import { z } from "zod";
import { marshall } from "@aws-sdk/util-dynamodb";
import { TransactWriteItem } from "@aws-sdk/client-dynamodb";
import {
  RestaurantCreditNoteRepository as Items,
  CreditKey,
} from "./credit-note-repository";
import { TransactionScope } from "./transaction-model";
import { restaurantsTableName } from "./restaurant-storage";

const money = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const RestaurantRefundBalanceSchema = z
  .object({
    creditNoteId: z.string().uuid(),
    creditNoteAmountMinor: money.positive(),
    currency: z.string().regex(/^[A-Z]{3}$/),
    refundedMinor: money,
    refundCount: money,
    version: money.positive(),
    entityType: z.literal("RESTAURANT_REFUND_BALANCE"),
    schemaVersion: z.literal(1),
  })
  .strict()
  .refine(
    (v) =>
      v.refundedMinor <= v.creditNoteAmountMinor &&
      v.refundCount <= v.refundedMinor,
  );
export const RefundCommandSchema = z
  .object({
    actorId: z.string(),
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    refundId: z.string().uuid(),
  })
  .strict();
/** Shared scoped exact-read/query adapter; only refund balances permit replacement. */
export class RestaurantRefundRepository extends Items {
  static balanceWrite(
    scope: TransactionScope,
    key: CreditKey,
    data: z.infer<typeof RestaurantRefundBalanceSchema>,
    before?: z.infer<typeof RestaurantRefundBalanceSchema>,
  ): TransactWriteItem {
    const type = "RESTAURANT_REFUND_BALANCE";
    if (!before)
      return this.put(
        scope,
        key,
        type,
        RestaurantRefundBalanceSchema.parse(data),
      );
    return {
      Put: {
        TableName: restaurantsTableName(),
        Item: marshall(
          this.row(scope, key, type, RestaurantRefundBalanceSchema.parse(data)),
        ),
        ConditionExpression:
          "entityType = :type AND orgId = :org AND outletId = :out AND #d.#v = :version AND #d.#r = :refunded AND #d.#a = :amount AND #d.#c = :currency AND #d.#n = :count",
        ExpressionAttributeNames: {
          "#d": "data",
          "#v": "version",
          "#r": "refundedMinor",
          "#a": "creditNoteAmountMinor",
          "#c": "currency",
          "#n": "refundCount",
        },
        ExpressionAttributeValues: marshall({
          ":type": type,
          ":org": scope.orgId,
          ":out": scope.outletId,
          ":version": before.version,
          ":refunded": before.refundedMinor,
          ":amount": before.creditNoteAmountMinor,
          ":currency": before.currency,
          ":count": before.refundCount,
        }),
      },
    };
  }
}
