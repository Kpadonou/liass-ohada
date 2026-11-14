import { validRestaurantSaleTax } from "./pilot-tax-calculation";
import { z } from "zod";
import { RestaurantInvoiceLineSchema } from "@liass-ohada/shared/restaurants";
import { restaurantQuantityAmountMinor } from "@liass-ohada/shared/restaurant-quantity";
import { TaxGroupTypeEnumSchema } from "../fiscal-compliance/providers/benin-emecef/invoice-dtos";

const classificationSchema = z
  .object({
    orderId: z.string().uuid(),
    itemId: z.string().uuid(),
    taxGroup: TaxGroupTypeEnumSchema,
    classificationEvidence: z.string().trim().min(1).max(1000),
    taxSpecificMinor: z.literal("0").optional(),
  })
  .strict();

/** Pure commercial-to-fiscal preparation mapping. Caller supplies complete verified
 * FINAL evidence. No authority, tax rate, price basis or provider-unit inference.
 * Amounts remain in original commercial minor units, never API price units.
 */
export function mapRestaurantFiscalLines(input: {
  lines: unknown;
  classifications: unknown;
}) {
  const lines = z
    .array(RestaurantInvoiceLineSchema)
    .min(1)
    .max(100)
    .parse(input.lines);
  const classifications = z
    .array(classificationSchema)
    .max(100)
    .parse(input.classifications);
  const key = (v: { orderId: string; itemId: string }) =>
    `${v.orderId}_${v.itemId}`;
  const treatments = new Map(classifications.map((v) => [key(v), v]));
  if (treatments.size !== classifications.length)
    throw Error("AMBIGUOUS_FISCAL_CLASSIFICATION");
  const seen = new Set<string>();
  let total = 0n;
  const mapped = lines.map((line) => {
    const sourceLineId = key(line);
    if (seen.has(sourceLineId)) throw Error("DUPLICATE_COMMERCIAL_LINE");
    seen.add(sourceLineId);
    const classification = treatments.get(sourceLineId);
    if (!classification) throw Error("MISSING_FISCAL_CLASSIFICATION");
    const snapshot = line.snapshot;
    if (
      snapshot.fiscalTreatment &&
      (classification.taxGroup !== snapshot.fiscalTreatment.effectiveGroup ||
        classification.classificationEvidence !==
          (snapshot.fiscalTreatment.evidenceReference ??
            snapshot.fiscalTreatment.regimeRevision))
    )
      throw Error("FISCAL_CLASSIFICATION_SOURCE_MISMATCH");
    const amount = restaurantQuantityAmountMinor(
      snapshot.unitPriceMinor,
      snapshot.quantity,
    );
    if (
      line.cancelledAt ||
      line.cancellationReason ||
      amount !== snapshot.grossMinor ||
      !validRestaurantSaleTax(snapshot) ||
      snapshot.lineTotalMinor !== line.netAmountMinor
    )
      throw Error("UNSUPPORTED_COMMERCIAL_LINE");
    total += BigInt(amount);
    return {
      sourceLineId,
      commercial: structuredClone(line),
      fiscal: {
        sourceLineId,
        taxGroup: classification.taxGroup,
        classificationEvidence: classification.classificationEvidence,
        ...(classification.taxSpecificMinor === undefined
          ? {}
          : { taxSpecificMinor: "0" as const }),
      },
    };
  });
  if (classifications.some((v) => !seen.has(key(v))))
    throw Error("UNKNOWN_CLASSIFIED_LINE");
  if (new Set(lines.map((v) => v.snapshot.currency)).size !== 1)
    throw Error("MIXED_CURRENCIES");
  return {
    lines: mapped,
    totalMinor: total.toString(),
    currency: lines[0].snapshot.currency,
    providerMutationEnabled: false as const,
  };
}
