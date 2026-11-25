import { createHash } from "node:crypto";
import * as c from "@liass-ohada/shared/restaurants";
import { canonical } from "@/lambda/shared/authority/integrity";
import { AppError } from "@/lambda/shared/app-error";
import { FiscalSourcePreparationProofService } from "@/lambda/shared/services/fiscal-source-preparation-proof-service";
import { mapRestaurantBeninRequest, restaurantBeninMappingSchema } from "./benin-fiscal-request-mapper";
import { prepareRestaurantFiscalInvoice } from "./fiscal-preparation";
import { RestaurantInvoiceSourceVerifier } from "./invoice-source-verifier";
import { RestaurantStaffService } from "./staff-service";

const scenario = {
  "01": { type: "FV", quantities: { A: [1] } },
  "02": { type: "FV", quantities: { B: [1] } },
  "03": { type: "FV", quantities: { A: [2], B: [3] } },
  "04": { type: "FV", quantities: { A: [2.5], B: [3.25] } },
  "05": { type: "FV", quantities: { A: [2], B: [3] }, customer: true },
  "07": { type: "FV", quantities: { B: [3] }, customer: true, specific: "B" },
  "08": { type: "FV", quantities: { A: [2], B: [3] }, aib: "B" },
  "09": { type: "FV", quantities: { A: [2], B: [3] }, customer: true, aib: "A" },
  "10": { type: "FV", quantities: { A: [2], B: [3] }, specific: "B", aib: "B" },
  "12": { type: "FV", quantities: { D: [2] } },
  "13": { type: "FV", quantities: { D: [2] }, specific: "D" },
  "14": { type: "FV", quantities: { E: [2] } },
  "15": { type: "FV", quantities: { E: [2] }, specific: "E" },
  "16": { type: "EV", quantities: { C: [2] } },
  "17": { type: "EV", quantities: { A: [2], C: [3] } },
  "19": { type: "EV", quantities: { E: [2] } },
} as const;
type EligibleScenario = keyof typeof scenario;
const providerPayment = {
  CASH: "ESPECES", MOBILE_MONEY: "MOBILEMONEY", CARD: "CARTEBANCAIRE",
} as const;
const fail = (code: string, status = 409): never => { throw new AppError(status, code); };

export class RestaurantFiscalAuthorizationPreparationService {
  static async prepareMapping(input: {
    orgId: string; actorId: string; outletId: string; sessionId: string; invoiceId: string;
    scenarioId: string; commandId: string; automaticPolicy?: boolean;
  }) {
    const request = c.RestaurantFiscalAuthorizationPreparationRequestSchema.parse({
      scenarioId: input.scenarioId, commandId: input.commandId,
    });
    const policy = scenario[request.scenarioId as EligibleScenario];
    if (!policy) return fail("FISCAL_SCENARIO_UNSUPPORTED", 400);
    const scope = { orgId: input.orgId, outletId: c.RestaurantIdSchema.parse(input.outletId) };
    const verified = await RestaurantInvoiceSourceVerifier.verify(
      scope, input.actorId, c.RestaurantIdSchema.parse(input.sessionId),
      c.RestaurantIdSchema.parse(input.invoiceId),
    );
    if (!verified.verified) return fail("FISCAL_SOURCE_UNAVAILABLE");
    if (!verified.evidence.issuanceProvenance.verified ||
      verified.evidence.issuanceProvenance.evidence.evidenceOrigin !== "AUTHENTIC")
      return fail("PROVENANCE_UNAVAILABLE");
    const prepared = await prepareRestaurantFiscalInvoice({
      scope, actorId: input.actorId, sessionId: input.sessionId,
      invoiceId: input.invoiceId, classifications: [], requireV1: true,
    }, async () => verified);
    if (!prepared.ready) return fail("FISCAL_PREPARATION_UNAVAILABLE");
    const groups = [...new Set(prepared.preparation.lines.map((line) => line.fiscal.taxGroup))].sort();
    const expectedGroups = Object.keys(policy.quantities).sort();
    if (canonical(groups) !== canonical(expectedGroups))
      return fail("FISCAL_SCENARIO_SOURCE_MISMATCH");
    const staff = await RestaurantStaffService.dto(
      input.orgId, await RestaurantStaffService.get(input.orgId, input.actorId),
    );
    if (!staff.displayName || staff.status !== "ACTIVE" || !staff.organizationMembershipActive)
      return fail("RESTAURANTS_STAFF_MEMBER_REQUIRED", 403);
    const mapping = restaurantBeninMappingSchema.parse({
      environment: "TEST", invoiceType: policy.type, priceBasis: "TTC",
      pricingEvidence: prepared.preparation.commercialRootDigest,
      commercialMinorUnitsPerFranc: 1, taxGroups: groups,
      taxMetadataEvidence: createHash("sha256").update(canonical(
        prepared.preparation.lines.map((line) => line.fiscal),
      )).digest("hex"),
      operator: {
        actorId: input.actorId, name: staff.displayName,
        evidence: `RESTAURANT_STAFF#${staff.version}`,
      },
      payments: Object.entries(prepared.preparation.paidByMethodMinor)
        .filter(([, amount]) => amount > 0)
        .map(([method]) => ({
          sourceMethod: method,
          providerMethod: providerPayment[method as keyof typeof providerPayment],
          evidence: prepared.preparation.commercialRootDigest,
        })),
    });
    const principal = { orgId: input.orgId, actorId: input.actorId };
    const identity = {
      orgId: input.orgId, environment: "TEST" as const, sourceDomain: "restaurants",
      sourceDocumentType: "INVOICE" as const, sourceDocumentId: input.invoiceId,
      jurisdiction: "BJ", obligation: "NORMALIZE",
    };
    const mapped = mapRestaurantBeninRequest(
      prepared.preparation, principal, identity, mapping, "AUTHORIZATION_PROOF",
    );
    const actualQuantities = Object.fromEntries(groups.map((group) => [
      group,
      prepared.preparation.lines
        .filter((line) => line.fiscal.taxGroup === group)
        .map((line) => line.commercial.snapshot.quantity)
        .sort((a, b) => a - b),
    ]));
    const expectedQuantities = Object.fromEntries(Object.entries(policy.quantities)
      .map(([group, quantities]) => [group, [...quantities].sort((a, b) => a - b)]));
    const requiresCustomer = "customer" in policy && policy.customer;
    const requiresSpecific = "specific" in policy ? policy.specific : undefined;
    const expectedAib = "aib" in policy ? policy.aib : undefined;
    const hasRequiredCustomer = Boolean(
      prepared.preparation.customer?.name && prepared.preparation.customer.ifu,
    );
    const hasRequiredSpecific = requiresSpecific === undefined || prepared.preparation.lines.some(
      (line) => line.fiscal.taxGroup === requiresSpecific &&
        BigInt(line.fiscal.taxSpecificMinor ?? 0) > 0n,
    );
    if (
      (!input.automaticPolicy && canonical(actualQuantities) !== canonical(expectedQuantities)) ||
      (requiresCustomer && !hasRequiredCustomer) ||
      !hasRequiredSpecific ||
      prepared.preparation.aib !== expectedAib
    ) fail("FISCAL_SCENARIO_SOURCE_MISMATCH");
    const fiscal = mapped.fiscalGroupTotals ?? {};
    const expectedFiscalTotals = {
      ta: 0, tb: 18, tc: 0, td: 18,
      taa: fiscal.A?.gross ?? 0, tab: fiscal.B?.gross ?? 0,
      tac: fiscal.C?.gross ?? 0, tad: fiscal.D?.gross ?? 0,
      tae: fiscal.E?.gross ?? 0, taf: 0,
      hab: fiscal.B?.net ?? 0, had: fiscal.D?.net ?? 0,
      vab: fiscal.B?.tax ?? 0, vad: fiscal.D?.tax ?? 0,
      aib: mapped.fiscalAdditionalTotals?.aib ?? 0,
      ts: mapped.fiscalAdditionalTotals?.ts ?? 0, total: mapped.total,
    };
    return { prepared: prepared.preparation, mapped, mapping, groups, expectedFiscalTotals, scenarioId: request.scenarioId };
  }
  static async prepare(input: Parameters<typeof RestaurantFiscalAuthorizationPreparationService.prepareMapping>[0]) {
    const { prepared, mapped, mapping, groups, expectedFiscalTotals, scenarioId } = await this.prepareMapping(input);
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    const operations = { CREATE: 1 as const, GET: 2 as const, CONFIRM: 1 as const, CANCEL: 1 as const };
    const proof = await FiscalSourcePreparationProofService.create({
      orgId: input.orgId, outletId: input.outletId, operatorUserId: input.actorId,
      sessionId: input.sessionId, invoiceId: input.invoiceId,
      sourceDigest: mapped.sourceDigest,
      sourceVersion: prepared.source.sourceVersion,
      financialRevision: prepared.source.financialRevision,
      sellerAuthorityDigest: prepared.provenance.seller.identityDigest,
      scenarioId, fiscalGroups: groups,
      fiscalMapping: mapping, expectedFiscalTotals, operations, expiresAt,
      commandId: input.commandId,
    });
    return c.RestaurantFiscalAuthorizationPreparationResponseSchema.parse({
      proofId: proof.proofId, proofDigest: proof.proofDigest,
      invoiceId: proof.invoiceId, scenarioId: proof.scenarioId,
      fiscalGroups: proof.fiscalGroups, expectedFiscalTotals: proof.expectedFiscalTotals,
      operations: proof.operations, expiresAt: proof.expiresAt, status: proof.status,
    });
  }
}
