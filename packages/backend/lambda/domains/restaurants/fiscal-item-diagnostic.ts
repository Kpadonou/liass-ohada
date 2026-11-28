import { GetItemCommand } from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { z } from "zod";
import { dynamoClient } from "@/lambda/shared/dynamo-client";
import { KeyFactory as K } from "@/lambda/shared/key-builder";
import { OrganizationFiscalRepository as Fiscal } from "@/lambda/shared/repositories/organization-fiscal-repository";
import { FiscalAttemptStore } from "../fiscal-compliance/persistence/fiscal-attempt-store";
import { BeninEMecefTestAdapter } from "../fiscal-compliance/providers/benin-emecef/benin-emecef-test-adapter";
import { prepareRestaurantFiscalInvoice } from "./fiscal-preparation";
import { canonical } from "@/lambda/shared/authority/integrity";
import { restaurantsTableName } from "./restaurant-storage";

const requestSchema = z.object({ type: z.literal("READ_BOUND_FISCAL_ITEM_TEST_V1"),
  orgId: z.string().min(1), outletId: z.string().uuid(), sessionId: z.string().uuid(),
  invoiceId: z.string().uuid(), uid: z.string().uuid() }).strict();

export function specificTaxObservation(details: { items?: readonly { taxSpecific?: number | null; price?: number; quantity?: number }[] | null }) {
  const item = details.items?.[0];
  const present = !!item && Object.hasOwn(item, "taxSpecific");
  return { itemCount: details.items?.length ?? null,
    taxSpecific: { present, type: present ? item!.taxSpecific === null ? "null" : typeof item!.taxSpecific : "missing",
      ...(present ? { value: item!.taxSpecific } : {}) },
    price: item?.price ?? null, quantity: item?.quantity ?? null };
}

/** IAM-only diagnostic. One provider GET; no attempt write or provider mutation. */
export async function readBoundFiscalItemTest(input: unknown) {
  const r = requestSchema.parse(input);
  if (process.env.STAGE !== "dev" || process.env.FISCAL_REAL_TEST_ENABLED !== "1")
    throw new Error("FISCAL_DIAGNOSTIC_SCOPE_DENIED");
  const intentKey = { PK: K.restaurantBillPK(r.orgId, r.outletId, r.invoiceId), SK: K.restaurantFiscalIntentSK() };
  const intentRaw = await dynamoClient.send(new GetItemCommand({ TableName: restaurantsTableName(),
    Key: marshall(intentKey), ConsistentRead: true }));
  const intent = intentRaw.Item ? unmarshall(intentRaw.Item) : undefined;
  if (intent?.orgId !== r.orgId || intent.outletId !== r.outletId ||
    intent.sessionId !== r.sessionId || intent.invoiceId !== r.invoiceId ||
    intent.fiscalBinding?.environment !== "TEST") throw new Error("FISCAL_DIAGNOSTIC_SOURCE_MISMATCH");
  const identity = { orgId: r.orgId, environment: "TEST" as const, sourceDomain: "restaurants",
    sourceDocumentType: "INVOICE", sourceDocumentId: r.invoiceId, jurisdiction: "BJ", obligation: "NORMALIZE" };
  const attempt = await new FiscalAttemptStore().readForStatus(identity);
  if (attempt?.status !== "CREATED" || attempt.uid !== r.uid ||
    canonical(attempt.fiscalBinding) !== canonical(intent.fiscalBinding))
    throw new Error("FISCAL_DIAGNOSTIC_ATTEMPT_MISMATCH");
  const source = await prepareRestaurantFiscalInvoice({ scope: { orgId: r.orgId, outletId: r.outletId },
    actorId: intent.actorId, sessionId: r.sessionId, invoiceId: r.invoiceId,
    classifications: [], requireV1: true });
  if (!source.ready || canonical(source.preparation.provenance.fiscalBinding) !== canonical(intent.fiscalBinding))
    throw new Error("FISCAL_DIAGNOSTIC_SOURCE_MISMATCH");
  const connection = await Fiscal.resolveBoundIssuanceConnection(r.orgId, intent.fiscalBinding);
  const credential = await Fiscal.credentialBinding(r.orgId,
    { stage: "dev", sub: intent.actorId, issuer: "https://executor.invalid" }, connection);
  const token = await Fiscal.readVerificationCredential(connection, credential);
  const details = await new BeninEMecefTestAdapter().getInvoiceForTestDiagnostic({ environment: "TEST", credential: token }, r.uid);
  return { uid: r.uid, ...specificTaxObservation(details),
    expectedSpecificTax: source.preparation.lines[0]?.fiscal.taxSpecificMinor ?? null,
    expectedTotal: attempt.expectedTotal, providerTotal: attempt.providerTotal };
}
