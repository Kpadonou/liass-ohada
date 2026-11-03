import * as c from "@liass-ohada/shared/restaurants";
import { KeyFactory as K } from "@/lambda/shared/key-builder";
import { RestaurantTransactionsRepository as R } from "./transaction-repository";
import { TransactionScope } from "./transaction-model";

export const EMPTY_DRAFT_REASON = "EMPTY_DRAFT";
/** A candidate only. Full canonical evidence must also be checked before a write. */
export function pureEmptyDraftHeader(order: c.RestaurantOrder) {
  return (
    order.status === "DRAFT" &&
    order.draftLineCount === 0 &&
    order.acceptedLineCount === 0 &&
    order.financialRevision === 0 &&
    order.dueMinor === 0 &&
    order.paidMinor === 0 &&
    order.reservedMinor === 0 &&
    order.pendingPaymentCount === 0 &&
    (order.outstandingWorkCount ?? 0) === 0 &&
    (order.paymentAttemptCount ?? 0) === 0 &&
    (order.succeededPaymentCount ?? 0) === 0 &&
    !order.paidByMethodMinor &&
    !order.closedAt &&
    !order.closedBy
  );
}
export async function qualifyPureEmptyDraft(
  scope: TransactionScope,
  order: c.RestaurantOrder,
  lines: c.RestaurantOrderItem[],
) {
  if (
    !pureEmptyDraftHeader(order) ||
    order.orgId !== scope.orgId ||
    order.outletId !== scope.outletId ||
    lines.length !== order.lineCount ||
    new Set(lines.map((line) => line.itemId)).size !== lines.length ||
    lines.some(
      (line) =>
        line.orgId !== scope.orgId ||
        line.outletId !== scope.outletId ||
        line.orderId !== order.orderId ||
        line.status !== "CANCELLED" ||
        line.snapshot ||
        line.latestFireId ||
        line.fireCount ||
        !line.cancelledAt ||
        !line.cancelledBy ||
        !line.cancellationReason,
    )
  )
    return false;
  const [submissions, preparation, payments] = await Promise.all([
    R.submissions(scope, order.orderId),
    R.query(
      scope,
      K.restaurantOrderPK(scope.orgId, scope.outletId, order.orderId),
      K.restaurantPreparationPrefix(),
      "PREPARATION",
      { limit: 1 },
    ),
    R.query(
      scope,
      K.restaurantOrderPK(scope.orgId, scope.outletId, order.orderId),
      K.restaurantPaymentReferencePrefix(),
      "PAYMENT_REFERENCE",
      { limit: 1 },
    ),
  ]);
  // No valid current writer can create payment/document/stock facts for a never-accepted
  // Order. Submission and preparation evidence are additionally checked fail-closed.
  return (
    submissions.length === 0 &&
    preparation.rows.length === 0 &&
    !preparation.nextCursor &&
    payments.rows.length === 0 &&
    !payments.nextCursor
  );
}
