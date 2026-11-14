import { validRestaurantSaleTax } from "./pilot-tax-calculation";
import { RestaurantIssuanceProvenanceRepository as Provenance } from "./issuance-provenance-repository";
import { z } from "zod";
import * as c from "@liass-ohada/shared/restaurants";
import { restaurantQuantityAmountMinor } from "@liass-ohada/shared/restaurant-quantity";
import { AppError } from "@/lambda/shared/app-error";
import { KeyFactory as K } from "@/lambda/shared/key-builder";
import { RestaurantReceiptRepository as Receipts } from "./receipt-repository";
import {
  RestaurantReceiptService as Publication,
  receiptPart,
  receiptSeed,
} from "./receipt-service";
import { RestaurantTransactionsService as Sessions } from "./transaction-service";
import { transactionFingerprint as hash } from "./transaction-repository";
import type { TransactionScope } from "./transaction-model";

type Immutable<T> = T extends object
  ? { readonly [P in keyof T]: Immutable<T[P]> }
  : T;
function freeze<T>(value: T): Immutable<T> {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value as Immutable<T>;
}
type DenialCode =
  | "INVALID_REQUEST"
  | "ACCESS_DENIED"
  | "SOURCE_UNAVAILABLE"
  | "NOT_FINAL"
  | "SOURCE_INTEGRITY"
  | "SOURCE_LIMIT"
  | "READ_UNAVAILABLE";
class Denial extends Error {
  constructor(readonly code: DenialCode) {
    super(code);
  }
}
function requireEvidence(condition: unknown): asserts condition {
  if (!condition) throw new Denial("SOURCE_INTEGRITY");
}
const requestSchema = z
  .object({
    orgId: z.string().min(1),
    outletId: z.string().uuid(),
    sessionId: z.string().uuid(),
    invoiceId: z.string().uuid(),
  })
  .strict();

/** Commercial evidence only. No fiscal eligibility, tax or authority inference.
 * Reads existing scoped keys sequentially; never publishes or repairs a source.
 */
export class RestaurantInvoiceSourceVerifier {
  static async verify(
    scope: TransactionScope,
    actorId: string,
    sessionId: string,
    invoiceId: string,
  ) {
    try {
      if (
        !requestSchema.safeParse({ ...scope, sessionId, invoiceId }).success ||
        !actorId
      )
        throw new Denial("INVALID_REQUEST");
      await Publication.authorize(scope, actorId);
      const session = (await Sessions.session(scope, sessionId)).data;
      requireEvidence(
        session.orgId === scope.orgId &&
          session.outletId === scope.outletId &&
          session.guestSessionId === sessionId,
      );
      if (!session.finalBillId) throw new Denial("NOT_FINAL");
      requireEvidence(session.finalBillId === invoiceId);
      const manifest = await Receipts.get(
        scope,
        invoiceId,
        K.restaurantTransactionMetaSK(),
        "MANIFEST",
      );
      if (!manifest) throw new Denial("SOURCE_UNAVAILABLE");
      if (manifest.state !== "FINAL") throw new Denial("NOT_FINAL");
      Publication.eligible(session);
      const result = (await Publication.finalResult(scope, manifest)).data
        .receipt;
      const {
        partCount,
        commercialPartCount,
        settlementPartCount,
        lineCount,
        paymentCount,
        digest,
        issuedAt,
        ...context
      } = result;
      requireEvidence(
        manifest.receiptId === invoiceId &&
          manifest.guestSessionId === sessionId &&
          hash(context) === hash(manifest.context) &&
          manifest.digest === digest &&
          manifest.partCount === partCount &&
          manifest.commercialPartCount === commercialPartCount &&
          manifest.settlementPartCount === settlementPartCount &&
          manifest.lineCount === lineCount &&
          manifest.paymentCount === paymentCount &&
          manifest.verifiedCount === partCount &&
          manifest.verifiedDigest === digest &&
          manifest.phase === "VALIDATE" &&
          !manifest.sourceCursor &&
          manifest.orderIndex === manifest.orders.length &&
          session.version === manifest.sourceVersion &&
          session.financialRevision === manifest.financialRevision &&
          session.closedAt === context.closedAt &&
          session.openedAt === context.openedAt &&
          session.currency === context.currency &&
          session.dueMinor === context.dueMinor &&
          session.paidMinor === context.paidMinor &&
          hash(
            session.paidByMethodMinor ?? { CASH: 0, MOBILE_MONEY: 0, CARD: 0 },
          ) === hash(context.paidByMethodMinor),
      );
      // Accepted bounded acquisition restrictions; these do not confer V1 eligibility.
      if (partCount > 2048 || lineCount > 2000)
        throw new Denial("SOURCE_LIMIT");
      requireEvidence(
        partCount === commercialPartCount + settlementPartCount &&
          context.dueMinor === context.paidMinor,
      );
      const orders = new Map(
        manifest.orders.map((order) => [order.orderId, order]),
      );
      requireEvidence(
        orders.size === manifest.orders.length &&
          orders.size === session.orderCount,
      );
      for (const order of orders.values()) {
        requireEvidence(
          order.orgId === scope.orgId &&
            order.outletId === scope.outletId &&
            order.guestSessionId === sessionId &&
            order.tableId === session.tableId &&
            order.orderType === "DINE_IN" &&
            ["CLOSED", "CANCELLED"].includes(order.status) &&
            order.currency === context.currency &&
            !order.draftLineCount &&
            !order.outstandingWorkCount &&
            !order.reservedMinor &&
            !order.pendingPaymentCount &&
            order.dueMinor === order.paidMinor &&
            order.acceptedLineCount <= order.lineCount,
        );
      }
      const parts: c.RestaurantReceiptPart[] = [];
      const lines: {
        coordinate: {
          orderId: string;
          itemId: string;
          partNumber: number;
          position: number;
        };
        line: z.infer<typeof c.RestaurantReceiptLineSchema>;
      }[] = [];
      const coordinates = new Set<string>(),
        payments = new Set<string>(),
        cursors = new Set<string>();
      const commercial = new Map<string, { count: number; amount: bigint }>();
      const allocations = new Map<string, { count: number; amount: bigint }>();
      const methods = { CASH: 0n, MOBILE_MONEY: 0n, CARD: 0n };
      let cursor: string | undefined,
        previous = receiptSeed(manifest.context, manifest.orders),
        bytes = 0;
      let commercialParts = 0,
        settlementParts = 0,
        total = 0n,
        paid = 0n,
        settlementStarted = false;
      do {
        const page = await Receipts.parts(scope, invoiceId, digest, partCount, {
          limit: 8,
          cursor,
          verifyComplete: true,
        });
        requireEvidence(page.parts.length > 0 || partCount === 0);
        for (const part of page.parts) {
          bytes += Buffer.byteLength(JSON.stringify(part), "utf8");
          if (bytes > 8 * 1024 * 1024) throw new Denial("SOURCE_LIMIT");
          requireEvidence(
            part.number === parts.length + 1 &&
              part.previousDigest === previous &&
              hash(
                receiptPart(part.number, part.previousDigest, part.content),
              ) === hash(part),
          );
          parts.push(part);
          previous = part.digest;
          if (part.content.kind === "COMMERCIAL") {
            requireEvidence(!settlementStarted);
            commercialParts++;
            for (const [position, line] of part.content.lines.entries()) {
              const identity = `${line.orderId}#${line.itemId}`,
                snapshot = line.snapshot;
              requireEvidence(
                !coordinates.has(identity) && orders.has(line.orderId),
              );
              coordinates.add(identity);
              const gross = restaurantQuantityAmountMinor(
                snapshot.unitPriceMinor,
                snapshot.quantity,
              );
              requireEvidence(
                snapshot.currency === context.currency &&
                  gross === snapshot.grossMinor &&
                  validRestaurantSaleTax(snapshot) &&
                  line.netAmountMinor ===
                    (line.cancelledAt ? 0 : snapshot.lineTotalMinor) &&
                  Boolean(line.cancelledAt) ===
                    Boolean(line.cancellationReason),
              );
              const aggregate = commercial.get(line.orderId) ?? {
                count: 0,
                amount: 0n,
              };
              aggregate.count++;
              aggregate.amount += BigInt(line.netAmountMinor);
              commercial.set(line.orderId, aggregate);
              total += BigInt(line.netAmountMinor);
              lines.push({
                coordinate: {
                  orderId: line.orderId,
                  itemId: line.itemId,
                  partNumber: part.number,
                  position,
                },
                line,
              });
              if (lines.length > 2000) throw new Denial("SOURCE_LIMIT");
            }
          } else {
            settlementStarted = true;
            settlementParts++;
            for (const payment of part.content.payments) {
              requireEvidence(!payments.has(payment.paymentId));
              payments.add(payment.paymentId);
              let allocated = 0n;
              const targets = new Set<string>();
              for (const allocation of payment.allocations) {
                requireEvidence(
                  orders.has(allocation.orderId) &&
                    !targets.has(allocation.orderId),
                );
                targets.add(allocation.orderId);
                allocated += BigInt(allocation.amountMinor);
                const aggregate = allocations.get(allocation.orderId) ?? {
                  count: 0,
                  amount: 0n,
                };
                aggregate.count++;
                aggregate.amount += BigInt(allocation.amountMinor);
                allocations.set(allocation.orderId, aggregate);
              }
              requireEvidence(allocated === BigInt(payment.appliedAmountMinor));
              requireEvidence(
                (payment.cashTenderedMinor === undefined) ===
                  (payment.changeMinor === undefined),
              );
              if (payment.method !== "CASH")
                requireEvidence(payment.cashTenderedMinor === undefined);
              if (payment.cashTenderedMinor !== undefined)
                requireEvidence(
                  BigInt(payment.cashTenderedMinor) - allocated ===
                    BigInt(payment.changeMinor!),
                );
              paid += allocated;
              methods[payment.method] += allocated;
            }
          }
        }
        if (page.nextCursor) {
          requireEvidence(
            parts.length < partCount && !cursors.has(page.nextCursor),
          );
          cursors.add(page.nextCursor);
        }
        cursor = page.nextCursor;
      } while (cursor);
      requireEvidence(
        parts.length === partCount &&
          previous === digest &&
          lines.length === lineCount &&
          commercialParts === commercialPartCount &&
          settlementParts === settlementPartCount &&
          payments.size === paymentCount &&
          total === BigInt(context.dueMinor) &&
          paid === BigInt(context.paidMinor) &&
          total === BigInt(manifest.commercialTotal) &&
          paid === BigInt(manifest.paidTotal),
      );
      for (const method of ["CASH", "MOBILE_MONEY", "CARD"] as const)
        requireEvidence(
          methods[method] === BigInt(context.paidByMethodMinor[method]) &&
            methods[method] === BigInt(manifest.methods[method]),
        );
      for (const order of orders.values()) {
        const economic = commercial.get(order.orderId) ?? {
          count: 0,
          amount: 0n,
        };
        const settlement = allocations.get(order.orderId) ?? {
          count: 0,
          amount: 0n,
        };
        requireEvidence(
          economic.count === order.acceptedLineCount &&
            economic.amount === BigInt(order.dueMinor) &&
            settlement.amount === BigInt(order.paidMinor) &&
            settlement.count === (order.succeededPaymentCount ?? 0),
        );
        const recorded = manifest.allocations[order.orderId];
        requireEvidence(
          settlement.amount === BigInt(recorded?.amount ?? 0) &&
            settlement.count === (recorded?.count ?? 0),
        );
      }
      requireEvidence(
        Object.keys(manifest.allocations).every((orderId) =>
          orders.has(orderId),
        ),
      );
      const issuanceProvenance = await Provenance.read(scope, manifest);
      if (
        manifest.issuanceProvenanceVersion === 1 &&
        !issuanceProvenance.verified
      )
        throw new Denial("SOURCE_INTEGRITY");
      // Recheck current authority before releasing complete evidence after a long read.
      await Publication.authorize(scope, actorId);
      return freeze({
        verified: true as const,
        evidence: {
          issuanceProvenance,
          source: {
            ...scope,
            guestSessionId: sessionId,
            invoiceId,
            sourceVersion: manifest.sourceVersion,
            financialRevision: manifest.financialRevision,
          },
          invoice: c.adaptReceiptSummaryToInvoice(result),
          proof: {
            algorithm: "RESTAURANT_RECEIPT_V1" as const,
            seed: receiptSeed(manifest.context, manifest.orders),
            digest,
            context: manifest.context,
            orders: manifest.orders,
          },
          parts,
          lines,
        },
      });
    } catch (error) {
      const code: DenialCode =
        error instanceof Denial
          ? error.code
          : error instanceof AppError
            ? error.statusCode === 403
              ? "ACCESS_DENIED"
              : error.statusCode === 404
                ? "SOURCE_UNAVAILABLE"
                : "SOURCE_INTEGRITY"
            : error instanceof z.ZodError
              ? "SOURCE_INTEGRITY"
              : "READ_UNAVAILABLE";
      return freeze({ verified: false as const, denial: { code } });
    }
  }
}
