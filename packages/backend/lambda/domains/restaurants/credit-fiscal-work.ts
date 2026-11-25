import { clean } from "@/lambda/shared/authority/integrity";
import { RestaurantFiscalSecuritySchema } from "@liass-ohada/shared/restaurants";
import { beninSfeScenarios, type BeninSfeScenarioId } from "../fiscal-compliance/providers/benin-emecef/sfe-scenarios";
import { GetItemCommand, UpdateItemCommand, type TransactWriteItem } from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { z } from "zod";
import { FiscalIssuanceBindingSchema } from "@liass-ohada/shared/shared";
import { KeyFactory as K } from "@/lambda/shared/key-builder";
import { dynamoClient } from "@/lambda/shared/dynamo-client";
import { restaurantsTableName } from "./restaurant-storage";
import { RestaurantCreditNoteFiscalSource } from "./credit-note-fiscal-source";
import { authorizeCreditPreparation } from "../fiscal-compliance/core/credit-workflow";
import { realFiscalTestEnabled } from "../fiscal-compliance/core/test-execution";

const schema = z.object({
  PK: z.string(), SK: z.literal("FISCAL_INTENT#V1"), entityType: z.literal("RESTAURANT_CREDIT_FISCAL_INTENT"),
  schemaVersion: z.literal(1), orgId: z.string(), outletId: z.string().uuid(),
  invoiceId: z.string().uuid(), creditNoteId: z.string().uuid(), sessionId: z.string().uuid(),
  actorId: z.string(), sourceReceiptDigest: z.string(), createdAt: z.string().datetime(),
  fiscalBinding: FiscalIssuanceBindingSchema, state: z.enum(["PENDING", "BLOCKED"]),
  reason: z.string().optional(), sourceDigest: z.string().optional(),
  originalEvidence: z.object({ originalObligationId: z.string(), sourceDigest: z.string(),
    originalType: z.enum(["FV", "EV"]), creditType: z.enum(["FA", "EA"]), security: RestaurantFiscalSecuritySchema,
    evidenceDigest: z.string(), printedReference: z.string().optional() }).strict().optional(),
}).strict();
export type CreditFiscalIntent = z.infer<typeof schema>;
/** Appended to the same commercial credit transaction. Existing KeyFactory
 * credit partition and fiscal intent SK; no new index or historical replay. */
export function creditFiscalIntentWrite(input: Omit<CreditFiscalIntent, "PK" | "SK" | "entityType" | "schemaVersion" | "state">): TransactWriteItem {
  const row = schema.parse({ ...input, PK: K.restaurantCreditNotePK(input.orgId, input.outletId, input.creditNoteId),
    SK: K.restaurantFiscalIntentSK(), entityType: "RESTAURANT_CREDIT_FISCAL_INTENT", schemaVersion: 1, state: "PENDING" });
  return { Put: { TableName: restaurantsTableName(), Item: marshall(row), ConditionExpression: "attribute_not_exists(PK)" } };
}
export async function processCreditFiscalIntent(raw: unknown) {
  const row = schema.parse(raw);
  const key = { PK: K.restaurantCreditNotePK(row.orgId, row.outletId, row.creditNoteId), SK: K.restaurantFiscalIntentSK() };
  if (row.PK !== key.PK) throw new Error("FISCAL_CREDIT_SCOPE_DENIED");
  if (row.state !== "PENDING" || row.fiscalBinding.environment !== "TEST" || !realFiscalTestEnabled()) return;
  let reason = "ORIGINAL_FISCAL_CERTIFICATION_REQUIRED", sourceDigest: string | undefined;
  let originalEvidence: ReturnType<typeof authorizeCreditPreparation>["original"] | undefined;
  try {
    const source = await RestaurantCreditNoteFiscalSource.verify({ orgId: row.orgId, outletId: row.outletId },
      row.actorId, row.sessionId, row.invoiceId, row.creditNoteId);
    if (source.credit.data.sourceReceiptDigest !== row.sourceReceiptDigest) throw new Error("FISCAL_SOURCE_MISMATCH");
    const authorization = authorizeCreditPreparation({ orgId: row.orgId, sourceDomain: "restaurants",
      originalInvoiceId: row.invoiceId, originalSourceDigest: source.original.proof.digest,
      creditSourceDigest: source.sourceDigest, fiscalBinding: row.fiscalBinding, original: source.originalFiscal });
    reason = authorization.reason; sourceDigest = authorization.sourceDigest; originalEvidence = authorization.original;
  } catch (error) {
    // Transient reads/auth failures retry the stream; never turn an ambiguous
    // read into provider permission. Only known domain refusals settle blocked.
    const code = error instanceof Error && "messageCode" in error ? String(error.messageCode) : error instanceof Error ? error.message : "";
    if (!["ORIGINAL_FISCAL_CERTIFICATION_REQUIRED", "FISCAL_SOURCE_MISMATCH", "FISCAL_CREDIT_BINDING_MISMATCH"].includes(code)) throw error;
    reason = code;
  }
  await dynamoClient.send(new UpdateItemCommand({ TableName: restaurantsTableName(), Key: marshall(key),
    UpdateExpression: "SET #state = :blocked, reason = :reason" + (sourceDigest ? ", sourceDigest = :digest, originalEvidence = :original" : ""),
    ConditionExpression: "entityType = :type AND #state = :pending AND fiscalBinding = :binding AND creditNoteId = :credit AND sourceReceiptDigest = :source",
    ExpressionAttributeNames: { "#state": "state" }, ExpressionAttributeValues: marshall({
      ":blocked": "BLOCKED", ":reason": reason, ":pending": "PENDING", ":type": row.entityType,
      ":binding": row.fiscalBinding, ":credit": row.creditNoteId, ":source": row.sourceReceiptDigest,
      ...(sourceDigest ? { ":digest": sourceDigest, ":original": clean(originalEvidence) } : {}),
    }) }));
}
export async function readCreditFiscalIntent(orgId: string, outletId: string, creditNoteId: string) {
  const key = { PK: K.restaurantCreditNotePK(orgId, outletId, creditNoteId), SK: K.restaurantFiscalIntentSK() };
  const result = await dynamoClient.send(new GetItemCommand({ TableName: restaurantsTableName(), Key: marshall(key), ConsistentRead: true }));
  if (!result.Item) return undefined;
  const row = schema.parse(unmarshall(result.Item));
  if (row.PK !== key.PK || row.orgId !== orgId || row.outletId !== outletId || row.creditNoteId !== creditNoteId)
    throw new Error("FISCAL_CREDIT_SCOPE_DENIED");
  return row;
}

/** Supported application preparation for a newly issued bound credit. It reads
 * the durable authorization; historical unbound credits never acquire one here. */
export async function prepareCreditFiscalAuthorization(input: { orgId: string; outletId: string; actorId: string;
  sessionId: string; invoiceId: string; creditNoteId: string; scenarioId: string }) {
  const source = await RestaurantCreditNoteFiscalSource.verify({ orgId: input.orgId, outletId: input.outletId },
    input.actorId, input.sessionId, input.invoiceId, input.creditNoteId);
  const intent = await readCreditFiscalIntent(input.orgId, input.outletId, input.creditNoteId);
  if (!intent || intent.invoiceId !== input.invoiceId || intent.sessionId !== input.sessionId)
    throw new Error("FISCAL_CREDIT_AUTHORIZATION_REQUIRED");
  const authorization = authorizeCreditPreparation({ orgId: input.orgId, sourceDomain: "restaurants",
    originalInvoiceId: input.invoiceId, originalSourceDigest: source.original.proof.digest,
    creditSourceDigest: source.sourceDigest, fiscalBinding: intent.fiscalBinding, original: source.originalFiscal });
  const requiredType = input.scenarioId === "06" ? "FA" : ["18", "20"].includes(input.scenarioId) ? "EA" : undefined;
  if (authorization.original.creditType !== requiredType) throw new Error("FISCAL_SCENARIO_SOURCE_MISMATCH");
  const policy = beninSfeScenarios[input.scenarioId as BeninSfeScenarioId];
  const groups = [...new Set(source.credit.lines.map(line => source.original.lines.find(original =>
    original.coordinate.orderId === line.orderId && original.coordinate.itemId === line.itemId)?.line.snapshot.fiscalTreatment?.effectiveGroup))].sort();
  if (!policy || JSON.stringify(groups) !== JSON.stringify(Object.keys(policy.quantities).sort()) ||
    input.scenarioId === "06" && (!source.original.invoice.customer?.name || !source.original.invoice.customer.ifu))
    throw new Error("FISCAL_SCENARIO_SOURCE_MISMATCH");
  return { creditNoteId: input.creditNoteId, invoiceId: input.invoiceId, environment: "TEST" as const,
    status: authorization.status, reason: authorization.reason, providerMutationAllowed: false as const,
    originalFiscalReference: authorization.original.security.codeMECeFDGI,
    originalPrintedReference: authorization.original.printedReference };
}
