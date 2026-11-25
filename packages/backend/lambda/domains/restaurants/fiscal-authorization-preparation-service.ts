import { createHash } from "node:crypto";
import * as c from "@liass-ohada/shared/restaurants";
import { canonical } from "@/lambda/shared/authority/integrity";
import { AppError } from "@/lambda/shared/app-error";
import { FiscalSourcePreparationProofService } from "@/lambda/shared/services/fiscal-source-preparation-proof-service";
import { mapRestaurantBeninRequest, restaurantBeninMappingSchema } from "./benin-fiscal-request-mapper";
import { prepareRestaurantFiscalInvoice } from "./fiscal-preparation";
import { RestaurantInvoiceSourceVerifier } from "./invoice-source-verifier";
import { RestaurantStaffService } from "./staff-service";

import { beninSfeScenarios, matchesBeninSfeScenario, type BeninSfeScenarioId, type SfeScenario } from "../fiscal-compliance/providers/benin-emecef/sfe-scenarios";
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
    const policy: SfeScenario | undefined = beninSfeScenarios[request.scenarioId as BeninSfeScenarioId];
    if (!policy || policy.stayTax || !["FV", "EV"].includes(policy.type)) return fail("FISCAL_SCENARIO_UNSUPPORTED", 400);
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
    if (!matchesBeninSfeScenario(request.scenarioId, {
      type: policy.type,
      items: prepared.preparation.lines.map(line => ({
        taxGroup: line.fiscal.taxGroup,
        quantity: line.commercial.snapshot.quantity,
        taxSpecific: line.fiscal.taxSpecificMinor,
      })),
      customer: prepared.preparation.customer,
      aib: prepared.preparation.aib,
    }, !input.automaticPolicy)) fail("FISCAL_SCENARIO_SOURCE_MISMATCH");
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
