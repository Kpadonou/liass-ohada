import { z } from "zod";
import { BeninEMecefConnectionSchema, FiscalCertificationSchema, FiscalCredentialAliasSchema } from "@liass-ohada/shared/fiscal-compliance";

const bounded = z.string().min(1).max(500);
const integer = z.string().max(80).regex(/^-?(0|[1-9]\d*)$/);
const decimal = z.string().max(80).regex(/^-?\d+(\.\d+)?$/);
/** Future evidence capacity only; S4B never creates these provider facts. */
export const BeninProviderSubmissionSnapshotSchema = z.object({ schemaVersion: z.literal(1), mappingVersion: bounded,
  ifu: bounded, type: z.enum(["FV", "EV", "FA", "EA"]), aib: z.enum(["A", "B"]).optional(),
  items: z.array(z.object({ code: bounded.optional(), name: z.string().min(1).max(2000), price: integer,
    quantity: decimal, taxGroup: z.enum(["A", "B", "C", "D", "E", "F"]), taxSpecific: integer.optional(),
    originalPrice: decimal.optional(), priceModification: bounded.optional() }).strict()).min(1).max(100),
  client: z.object({ ifu: bounded.optional(), name: bounded.optional(), contact: bounded.optional(), address: bounded.optional() }).strict().optional(),
  operator: z.object({ id: bounded.optional(), name: bounded }).strict(),
  payment: z.array(z.object({ name: z.enum(["ESPECES", "VIREMENT", "CARTEBANCAIRE", "MOBILEMONEY", "CHEQUES", "CREDIT", "AUTRE"]), amount: integer }).strict()).max(20).optional(),
  reference: bounded.optional(),
}).strict();
export const BeninProviderTotalsSchema = z.object({ ta: integer, tb: integer, tc: integer, td: integer,
  taa: integer, tab: integer, tac: integer, tad: integer, tae: integer, taf: integer,
  hab: integer, had: integer, vab: integer, vad: integer, aib: integer, ts: integer, total: integer }).strict();
export const BeninSecurityElementsSchema = z.object({ dateTime: bounded, qrCode: z.string().min(1).max(4096),
  codeMECeFDGI: bounded, counters: bounded, nim: bounded }).strict();
export const FiscalConnectionInternalSchema = BeninEMecefConnectionSchema.omit({ credentialConfigured: true }).extend({
  credentialAlias: FiscalCredentialAliasSchema.optional(),
}).strict();
export const FiscalCertificationInternalSchema = FiscalCertificationSchema.extend({
  credentialAliasSnapshot: FiscalCredentialAliasSchema.optional(),
  providerEvidence: z.object({ uid: bounded, submissionSnapshot: BeninProviderSubmissionSnapshotSchema,
    totals: BeninProviderTotalsSchema, securityElements: BeninSecurityElementsSchema.optional() }).strict().optional(),
}).strict().refine(v => v.status !== "CERTIFIED" || (v.totalsComparison === "MATCH" && !!v.providerEvidence?.securityElements),
  { message: "Certified state requires complete provider evidence" });
export type FiscalConnectionInternal = z.infer<typeof FiscalConnectionInternalSchema>;
export type FiscalCertificationInternal = z.infer<typeof FiscalCertificationInternalSchema>;
