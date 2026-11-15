import { createHash } from "node:crypto";
import { clean } from "@/lambda/shared/authority/integrity";
import { restaurantQuantityAmountMinor } from "@liass-ohada/shared/restaurant-quantity";
import type { FiscalPrincipal, VerifiedFiscalPreparation } from "../fiscal-compliance/core/synthetic-fiscal-orchestrator";
import type { FiscalObligationIdentity } from "../fiscal-compliance/core/fiscal-attempt-state";
import { InvoiceRequestDataDtoSchema, canonicalBeninRequest } from "../fiscal-compliance/providers/benin-emecef/invoice-dtos";
import { RestaurantCreditNoteFiscalSource } from "./credit-note-fiscal-source";
import { calculateRestaurantFiscalAmounts } from "./fiscal-treatment";
import { prepareRestaurantFiscalInvoice } from "./fiscal-preparation";
import { mapRestaurantBeninRequest, restaurantBeninCreditMappingSchema } from "./benin-fiscal-request-mapper";

/** Credit preparation reuses the immutable original invoice classification and
 * Restaurants' atomic commercial credit controls. No credit tax group is supplied
 * by the caller and no commercial number is used as the DGI reference. */
export async function prepareRestaurantBeninCredit(input: {
  principal: FiscalPrincipal;
  identity: FiscalObligationIdentity;
  outletId: string;
  sessionId: string;
  invoiceId: string;
  classifications: unknown;
  mapping: unknown;
}): Promise<VerifiedFiscalPreparation> {
  const { principal, identity } = input;
  if (identity.orgId !== principal.orgId || identity.sourceDomain !== "restaurants" ||
    identity.sourceDocumentType !== "CREDIT_NOTE" || identity.environment !== "TEST" ||
    identity.jurisdiction !== "BJ") throw new Error("FISCAL_MAPPING_SCOPE_DENIED");
  const config = restaurantBeninCreditMappingSchema.parse(input.mapping);
  if (config.commercialMinorUnitsPerFranc !== 1)
    throw new Error("FISCAL_CREDIT_UNIT_CONVERSION_UNSUPPORTED");
  const scope = { orgId: principal.orgId, outletId: input.outletId };
  const source = await RestaurantCreditNoteFiscalSource.verify(scope, principal.actorId,
    input.sessionId, input.invoiceId, identity.sourceDocumentId);
  const originalType = source.originalFiscal.fiscalDocumentType;
  if ((originalType === "FV" ? "FA" : "EA") !== config.invoiceType)
    throw new Error("FISCAL_ORIGINAL_TYPE_MISMATCH");
  const original = await prepareRestaurantFiscalInvoice({ scope, actorId: principal.actorId,
    sessionId: input.sessionId, invoiceId: input.invoiceId,
    classifications: input.classifications, requireV1: true });
  if (!original.ready || original.preparation.commercialRootDigest !== source.original.proof.digest ||
    original.preparation.aib) throw new Error("FISCAL_ORIGINAL_PREPARATION_UNAVAILABLE");
  const originalIdentity = { ...identity, sourceDocumentType: "INVOICE", sourceDocumentId: input.invoiceId };
  const mappedOriginal = mapRestaurantBeninRequest(original.preparation, principal,
    originalIdentity, { ...config, invoiceType: originalType });
  if (mappedOriginal.sourceDigest !== source.originalFiscal.sourceDigest)
    throw new Error("FISCAL_ORIGINAL_SOURCE_MISMATCH");
  const originalInvoice = (mappedOriginal.payload as { invoice: { ifu: string;
    client?: { ifu?: string; name?: string; contact?: string; address?: string };
    items: { name: string; price: number; quantity: number; taxGroup: "A"|"B"|"C"|"D"|"E"|"F"; taxSpecific?: number }[] } }).invoice;
  const groupTotals: NonNullable<VerifiedFiscalPreparation["fiscalGroupTotals"]> = {};
  const items = source.credit.lines.map(line => {
    const index = original.preparation.lines.findIndex(v => v.commercial.orderId === line.orderId &&
      v.commercial.itemId === line.itemId);
    const originalLine = original.preparation.lines[index];
    const item = originalInvoice.items[index];
    if (!originalLine || !item || item.taxGroup === "F" ||
      line.unitAmountMinor !== item.price ||
      restaurantQuantityAmountMinor(item.price, line.creditedQuantity) !== line.creditedAmountMinor ||
      line.creditedQuantity > item.quantity ||
      (item.taxSpecific !== undefined && line.creditedQuantity !== item.quantity))
      throw new Error("FISCAL_CREDIT_LINE_MISMATCH");
    const treatment = originalLine.commercial.snapshot.fiscalTreatment;
    if (!treatment || treatment.effectiveGroup !== item.taxGroup)
      throw new Error("FISCAL_CREDIT_TREATMENT_UNAVAILABLE");
    const amount = line.creditedAmountMinor;
    const specific = item.taxSpecific ?? 0;
    const split = calculateRestaurantFiscalAmounts(amount - specific, treatment);
    if (split.taxMinor !== line.taxMinor) throw new Error("FISCAL_CREDIT_TAX_MISMATCH");
    const old = groupTotals[item.taxGroup] ?? { gross: 0, net: 0, tax: 0 };
    groupTotals[item.taxGroup] = { gross: old.gross + amount,
      net: old.net + split.netMinor, tax: old.tax + split.taxMinor };
    return { code: `${line.orderId}_${line.itemId}`, name: item.name,
      price: item.price, quantity: line.creditedQuantity, taxGroup: item.taxGroup,
      ...(item.taxSpecific !== undefined ? { taxSpecific: item.taxSpecific } : {}) };
  });
  const groups = new Set(items.map(v => v.taxGroup));
  if (config.invoiceType === "FA" && groups.has("C") ||
    config.invoiceType === "EA" && !(
      groups.size === 1 && (groups.has("C") || groups.has("E")) ||
      groups.size === 2 && groups.has("A") && groups.has("C")))
    throw new Error("UNSUPPORTED_EXPORT_TAX_COMBINATION");
  const total = source.credit.data.amountMinor;
  if (items.reduce((sum, item) => sum + restaurantQuantityAmountMinor(item.price, item.quantity), 0) !== total)
    throw new Error("FISCAL_CREDIT_AMOUNT_MISMATCH");
  const invoice = InvoiceRequestDataDtoSchema.parse({ ifu: originalInvoice.ifu,
    type: config.invoiceType, reference: source.originalFiscal.security!.codeMECeFDGI,
    operator: { name: config.operator.name }, items,
    ...(originalInvoice.client ? { client: originalInvoice.client } : {}) });
  const payload = { invoice, expected: { itemTotals: source.credit.lines.map(v => v.creditedAmountMinor), total } };
  return { identity, sourceDigest: source.sourceDigest,
    requestDigest: createHash("sha256").update(canonicalBeninRequest(clean(payload))).digest("hex"),
    total, fiscalGroupTotals: groupTotals,
    fiscalAdditionalTotals: { aib: 0,
      ts: items.reduce((sum, item) => sum + (item.taxSpecific ?? 0), 0) },
    payload };
}
