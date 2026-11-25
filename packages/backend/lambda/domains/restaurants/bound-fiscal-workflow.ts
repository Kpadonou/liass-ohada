import { canonical } from "@/lambda/shared/authority/integrity";
import { OrganizationFiscalRepository as Fiscal } from "@/lambda/shared/repositories/organization-fiscal-repository";
import type { FiscalIssuanceBinding } from "@liass-ohada/shared/shared";
import { realFiscalTestEnabled } from "../fiscal-compliance/core/test-execution";
import { RestaurantFiscalAuthorizationPreparationService } from "./fiscal-authorization-preparation-service";
import { prepareRestaurantFiscalInvoice } from "./fiscal-preparation";
import { restaurantBeninRealTestWorkflow } from "./benin-real-test-workflow";

/** Restaurants supplies its source and mapping. The existing fiscal engine owns all commands. */
export async function prepareBoundRestaurantWorkflow(work: {
  orgId: string; outletId: string; sessionId: string; invoiceId: string; actorId: string;
  fiscalBinding: FiscalIssuanceBinding;
}) {
  const { fiscalBinding, orgId, outletId, sessionId, invoiceId, actorId } = work;
  const stage = process.env.STAGE;
  if (!realFiscalTestEnabled() || fiscalBinding.environment !== "TEST" || (stage !== "dev" && stage !== "test") ||
    (fiscalBinding.issuancePointId !== undefined && fiscalBinding.issuancePointId !== outletId))
    throw new Error("FISCAL_AUTOMATIC_SCOPE_DENIED");
  const source = await prepareRestaurantFiscalInvoice({ scope: { orgId, outletId }, actorId,
    sessionId, invoiceId, classifications: [], requireV1: true });
  if (!source.ready || canonical(source.preparation.provenance.fiscalBinding) !== canonical(fiscalBinding))
    throw new Error("FISCAL_SOURCE_MISMATCH");
  const groups = [...new Set(source.preparation.lines.map(line => line.fiscal.taxGroup))].sort().join(",");
  const scenarioId = ({ A: "01", B: "02", "A,B": "03" } as Record<string, string>)[groups];
  if (!scenarioId) throw new Error("FISCAL_SCENARIO_UNSUPPORTED");
  const { mapping, expectedFiscalTotals, mapped } = await RestaurantFiscalAuthorizationPreparationService.prepareMapping({
    ...work, scenarioId, commandId: invoiceId, automaticPolicy: true,
  });
  const connection = await Fiscal.resolveBoundIssuanceConnection(orgId, fiscalBinding);
  const credential = await Fiscal.credentialBinding(orgId, { stage, sub: actorId, issuer: "https://executor.invalid" }, connection);
  const token = await Fiscal.readVerificationCredential(connection, credential);
  const { taxpayerIfu: ifu, nim } = connection.data;
  if (!ifu || !nim) throw new Error("PLATFORM_FISCAL_CREDENTIAL_INVALID");
  const workflow = restaurantBeninRealTestWorkflow({ orgId, outletId, sessionId, invoiceId,
    operatorUserId: actorId, token, ifu, nim, sourceDigest: mapped.sourceDigest,
    classifications: [], mapping, expectedFiscalTotals, fiscalBinding,
  }, async (principal, identity, action) => {
    if (principal.orgId !== orgId || principal.actorId !== actorId || identity.environment !== fiscalBinding.environment ||
      identity.sourceDocumentId !== invoiceId || !["CREATE", "READ", "CONFIRM"].includes(action))
      throw new Error("FISCAL_AUTOMATIC_SCOPE_DENIED");
    const current = await Fiscal.resolveBoundIssuanceConnection(orgId, fiscalBinding);
    if (current.data.version !== connection.data.version || current.secretReference !== connection.secretReference)
      throw new Error("FISCAL_CONNECTION_CHANGED");
  });
  return { workflow, principal: { orgId, actorId }, identity: { orgId, environment: "TEST" as const,
    sourceDomain: "restaurants", sourceDocumentType: "INVOICE", sourceDocumentId: invoiceId,
    jurisdiction: "BJ", obligation: "NORMALIZE" } };
}
