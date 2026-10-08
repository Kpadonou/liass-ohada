import { z } from "zod";
import { SalesFiscalizableDocumentSchema } from "../sales/sales-fiscalizable-document";

export const FiscalIdSchema = z.string().max(200).regex(/^[A-Za-z0-9_-]+$/);
export const FiscalEnvironmentSchema = z.enum(["TEST", "PRODUCTION"]);
export const FiscalSourceTypeSchema = z.enum(["INVOICE", "CREDIT_NOTE"]);
export const FiscalCertificationStatusSchema = z.enum(["UNPREPARED", "PREPARED", "SUBMITTING", "PENDING", "READY_TO_CONFIRM",
  "CANCELLING", "CONFIRMING", "CERTIFIED", "CANCELLED", "REJECTED", "RECONCILIATION_REQUIRED", "EXPIRED"]);
export const BeninDocumentTypeSchema = z.enum(["FV", "EV", "FA", "EA"]);
export const BeninTaxGroupSchema = z.enum(["A", "B", "C", "D", "E", "F"]);
const text = (max: number) => z.string().trim().min(1).max(max);
const minor = z.string().max(80).regex(/^(0|[1-9]\d*)$/);
const version = z.number().int().positive();
const timestamps = { version, createdAt: z.string().datetime(), updatedAt: z.string().datetime() };
const profileFields = {
  sellerIfu: text(100).optional(), legalName: text(160).optional(), rccm: text(160).optional(),
  address: text(1000).optional(), phone: text(40).optional(), email: z.string().email().max(254).optional(),
  approvalEvidence: z.object({ reference: text(200), softwareVersion: text(100),
    approvedScope: z.array(BeninDocumentTypeSchema).min(1).max(4), approvedAt: z.string().datetime(),
    evidenceReference: text(200) }).strict().optional(),
};
export const BeninFiscalProfileSchema = z.object({ country: z.literal("BJ"), ...profileFields, ...timestamps }).strict();
/** PUT replaces local configuration; version zero conditionally creates the profile. */
export const PutBeninFiscalProfileRequestSchema = z.object({ ...profileFields, expectedVersion: z.number().int().min(0) }).strict();
const connectionFields = {
  nim: text(100).optional(), shopName: text(160).optional(), address1: text(300).optional(),
  address2: text(300).optional(), address3: text(160).optional(), contact1: text(254).optional(),
  contact2: text(254).optional(), contact3: text(254).optional(), apiVersion: text(100).optional(),
};
/** Symbolic server-managed reference only: no token, ARN or secret URL can fit this grammar. */
export const FiscalCredentialAliasSchema = z.string().regex(/^[a-z][a-z0-9_-]{0,79}$/);
export const BeninEMecefConnectionSchema = z.object({ connectionId: FiscalIdSchema, country: z.literal("BJ"),
  provider: z.literal("BENIN_E_MECEF"), environment: FiscalEnvironmentSchema,
  ...connectionFields, credentialConfigured: z.boolean(), ...timestamps }).strict();
export const CreateBeninConnectionRequestSchema = z.object({ environment: FiscalEnvironmentSchema,
  ...connectionFields, credentialAlias: FiscalCredentialAliasSchema.optional() }).strict();
export const UpdateBeninConnectionRequestSchema = z.object({ ...connectionFields,
  credentialAlias: FiscalCredentialAliasSchema.nullable().optional(), expectedVersion: version }).strict();
export const FiscalConnectionIdRequestSchema = z.object({ environment: FiscalEnvironmentSchema, connectionId: FiscalIdSchema }).strict();
export const ListFiscalConnectionsRequestSchema = z.object({ environment: FiscalEnvironmentSchema,
  limit: z.coerce.number().int().min(1).max(100).default(50), cursor: text(2000).optional() }).strict();
export const FiscalConnectionListSchema = z.object({ items: z.array(BeninEMecefConnectionSchema).max(100), nextCursor: text(2000).optional() }).strict();
export const BeninPreparationInputSchema = z.object({
  connectionId: FiscalIdSchema.optional(), documentType: BeninDocumentTypeSchema.optional(),
  tradeClassification: z.enum(["DOMESTIC", "EXPORT"]).optional(), classificationEvidence: text(1000).optional(),
  lines: z.array(z.object({ sourceLineId: FiscalIdSchema, taxGroup: BeninTaxGroupSchema.optional(),
    classificationEvidence: text(1000).optional(), taxSpecificMinor: minor.optional() }).strict()).max(100),
  buyerIdentity: z.object({ kind: z.enum(["BJ_IFU", "NO_IFU"]), ifu: text(100).optional(),
    evidence: text(1000).optional() }).strict().refine(v => v.kind === "BJ_IFU" ? !!v.ifu : !v.ifu).optional(),
  operator: z.object({ id: text(100).optional(), name: text(160) }).strict().optional(),
  aib: z.enum(["NONE", "A", "B"]).optional(),
  paymentDeclaration: z.array(z.object({ method: z.enum(["ESPECES", "VIREMENT", "CARTEBANCAIRE", "MOBILEMONEY", "CHEQUES", "CREDIT", "AUTRE"]),
    amountMinor: minor }).strict()).min(1).max(20).optional(),
}).strict();
export const FiscalSourceRequestSchema = z.object({ environment: FiscalEnvironmentSchema,
  sourceDocumentType: FiscalSourceTypeSchema, sourceDocumentId: FiscalIdSchema }).strict();
export const PrepareFiscalCertificationRequestSchema = FiscalSourceRequestSchema.extend({
  originalInvoiceId: FiscalIdSchema.optional(), clientRequestId: z.string().uuid(),
  preparation: BeninPreparationInputSchema,
}).strict().refine(v => v.sourceDocumentType === "CREDIT_NOTE" ? !!v.originalInvoiceId : !v.originalInvoiceId);
export const ReviseFiscalCertificationRequestSchema = FiscalSourceRequestSchema.extend({
  expectedVersion: version, clientRequestId: z.string().uuid(), preparation: BeninPreparationInputSchema,
}).strict();
export const FiscalReadinessIssueCodeSchema = z.enum(["FISCAL_PROFILE_MISSING", "SELLER_IFU_MISSING", "SELLER_LEGAL_IDENTITY_INCOMPLETE",
  "CONNECTION_MISSING", "CREDENTIAL_REFERENCE_MISSING", "CONNECTION_NIM_MISSING", "FISCAL_CLASSIFICATION_INCOMPLETE",
  "BUYER_FISCAL_IDENTITY_INCOMPLETE", "OPERATOR_INCOMPLETE", "PAYMENT_DECLARATION_INCOMPLETE", "AIB_CLASSIFICATION_INCOMPLETE",
  "ORIGINAL_FISCAL_CERTIFICATION_REQUIRED", "CURRENCY_PROVIDER_CONFIRMATION_REQUIRED", "PROVIDER_MAPPING_NOT_ENABLED"]);
export const FiscalLocalReadinessSchema = z.object({ kind: z.literal("LOCAL_READINESS"),
  localInputsComplete: z.boolean(), providerMutationEnabled: z.literal(false),
  issues: z.array(z.object({ code: FiscalReadinessIssueCodeSchema, sourceLineId: FiscalIdSchema.optional() }).strict()).max(120) }).strict();
export const FiscalPreparationSnapshotSchema = z.object({ schemaVersion: z.literal(1), integrationVersion: z.literal("S4B-1"),
  environment: FiscalEnvironmentSchema, source: SalesFiscalizableDocumentSchema,
  seller: BeninFiscalProfileSchema.nullable(), connection: BeninEMecefConnectionSchema.nullable(),
  fiscal: BeninPreparationInputSchema,
  originalCertification: z.object({ certificationId: FiscalIdSchema, sourceDocumentId: FiscalIdSchema, version,
    documentType: z.enum(["FV", "EV"]), codeMECeFDGI: text(500), environment: FiscalEnvironmentSchema }).strict().optional(),
  readiness: FiscalLocalReadinessSchema, preparedAt: z.string().datetime(),
}).strict();
export const FiscalCertificationSchema = z.object({ id: FiscalIdSchema, country: z.literal("BJ"), provider: z.literal("BENIN_E_MECEF"),
  environment: FiscalEnvironmentSchema, sourceDocumentType: FiscalSourceTypeSchema, sourceDocumentId: FiscalIdSchema,
  sourceVersion: version, sourceDigest: z.string().regex(/^[a-f0-9]{64}$/), status: FiscalCertificationStatusSchema,
  totalsComparison: z.enum(["NOT_RUN", "MATCH", "MISMATCH"]), preparationSnapshot: FiscalPreparationSnapshotSchema,
  ...timestamps }).strict();
export type BeninFiscalProfile = z.infer<typeof BeninFiscalProfileSchema>;
export type BeninEMecefConnection = z.infer<typeof BeninEMecefConnectionSchema>;
export type FiscalCertification = z.infer<typeof FiscalCertificationSchema>;
export type FiscalPreparationSnapshot = z.infer<typeof FiscalPreparationSnapshotSchema>;
export type BeninPreparationInput = z.infer<typeof BeninPreparationInputSchema>;
export type FiscalSourceRequest = z.infer<typeof FiscalSourceRequestSchema>;
export type FiscalEnvironment = z.infer<typeof FiscalEnvironmentSchema>;
export type FiscalLocalReadiness = z.infer<typeof FiscalLocalReadinessSchema>;
