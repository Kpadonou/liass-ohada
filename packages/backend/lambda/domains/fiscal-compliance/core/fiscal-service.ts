import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import {
  BeninFiscalProfileSchema, BeninEMecefConnectionSchema, PutBeninFiscalProfileRequestSchema,
  CreateBeninConnectionRequestSchema, UpdateBeninConnectionRequestSchema, FiscalConnectionIdRequestSchema,
  ListFiscalConnectionsRequestSchema, PrepareFiscalCertificationRequestSchema, ReviseFiscalCertificationRequestSchema,
  FiscalSourceRequestSchema, FiscalCertificationSchema, FiscalPreparationSnapshotSchema,
  FiscalLocalReadiness, FiscalLocalReadinessSchema, BeninPreparationInput, FiscalSourceRequest,
} from "@liass-ohada/shared/fiscal-compliance";
import { SalesFiscalizableDocument } from "@liass-ohada/shared/sales";
import { AppError } from "@/lambda/shared/app-error";
import { KeyFactory } from "@/lambda/shared/key-builder";
import { SalesFiscalSourceService } from "../../sales/references/sales-fiscal-source-service";
import { FiscalRepository, FiscalWriteConflict } from "./fiscal-repository";
import { FiscalCertificationInternal, FiscalCertificationInternalSchema, FiscalConnectionInternal, FiscalConnectionInternalSchema } from "./fiscal-persistence-model";

const tenant = (orgId: string) => z.string().min(1).max(200).parse(orgId);
const actor = (userId: string) => z.string().min(1).max(200).parse(userId);
export const publicConnection = (value: FiscalConnectionInternal) => {
  const { credentialAlias, ...data } = value;
  return BeninEMecefConnectionSchema.parse({ ...data, credentialConfigured: !!credentialAlias });
};
export const publicCertification = (value: FiscalCertificationInternal) => {
  const { credentialAliasSnapshot: _alias, providerEvidence: _evidence, ...data } = value;
  return FiscalCertificationSchema.parse(data);
};
export function assertLocallyEditable(value: Pick<FiscalCertificationInternal, "status" | "providerEvidence">) {
  if (!["UNPREPARED", "PREPARED"].includes(value.status) || value.providerEvidence) throw new AppError(409, "FISCAL_PREPARATION_NOT_EDITABLE");
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  return JSON.stringify(value);
}
const intent = (kind: string, request: unknown) => createHash("sha256").update(canonical({ kind, request })).digest("hex");

export class FiscalService {
  static async getProfile(orgId: string) { return (await FiscalRepository.getProfile(tenant(orgId))) ?? null; }
  static async putProfile(orgId: string, userId: string, input: z.input<typeof PutBeninFiscalProfileRequestSchema>) {
    tenant(orgId); actor(userId);
    const { expectedVersion, ...fields } = PutBeninFiscalProfileRequestSchema.parse(input);
    const previous = await FiscalRepository.getProfile(orgId);
    if ((previous?.version ?? 0) !== expectedVersion) throw new AppError(409, "FISCAL_PROFILE_VERSION_CONFLICT");
    const now = new Date().toISOString();
    const profile = BeninFiscalProfileSchema.parse({ ...fields, country: "BJ", version: expectedVersion + 1,
      createdAt: previous?.createdAt ?? now, updatedAt: now });
    try { await FiscalRepository.saveConfiguration(orgId, KeyFactory.fiscalProfileSK(), "FISCAL_PROFILE", profile, expectedVersion, userId); }
    catch (e) { if (e instanceof FiscalWriteConflict) throw new AppError(409, "FISCAL_PROFILE_VERSION_CONFLICT"); throw e; }
    return profile;
  }
  static async createConnection(orgId: string, userId: string, input: z.input<typeof CreateBeninConnectionRequestSchema>) {
    tenant(orgId); actor(userId);
    const fields = CreateBeninConnectionRequestSchema.parse(input);
    const now = new Date().toISOString();
    const connection = FiscalConnectionInternalSchema.parse({ ...fields, connectionId: randomUUID(), country: "BJ",
      provider: "BENIN_E_MECEF", version: 1, createdAt: now, updatedAt: now });
    await FiscalRepository.saveConfiguration(orgId, KeyFactory.fiscalConnectionSK(connection.environment, connection.connectionId),
      "FISCAL_CONNECTION", connection, 0, userId);
    return publicConnection(connection);
  }
  static async getConnection(orgId: string, input: z.input<typeof FiscalConnectionIdRequestSchema>) {
    tenant(orgId); const { environment, connectionId } = FiscalConnectionIdRequestSchema.parse(input);
    const connection = await FiscalRepository.getConnection(orgId, environment, connectionId);
    if (!connection) throw new AppError(404, "FISCAL_CONNECTION_NOT_FOUND");
    return publicConnection(connection);
  }
  static async updateConnection(orgId: string, userId: string, identity: z.input<typeof FiscalConnectionIdRequestSchema>,
    input: z.input<typeof UpdateBeninConnectionRequestSchema>) {
    tenant(orgId); actor(userId);
    const { environment, connectionId } = FiscalConnectionIdRequestSchema.parse(identity);
    const { expectedVersion, ...fields } = UpdateBeninConnectionRequestSchema.parse(input);
    const previous = await FiscalRepository.getConnection(orgId, environment, connectionId);
    if (!previous) throw new AppError(404, "FISCAL_CONNECTION_NOT_FOUND");
    if (previous.version !== expectedVersion) throw new AppError(409, "FISCAL_CONNECTION_VERSION_CONFLICT");
    const connection = FiscalConnectionInternalSchema.parse({ ...previous, ...fields,
      credentialAlias: fields.credentialAlias === null ? undefined : fields.credentialAlias ?? previous.credentialAlias,
      version: expectedVersion + 1, updatedAt: new Date().toISOString() });
    try { await FiscalRepository.saveConfiguration(orgId, KeyFactory.fiscalConnectionSK(environment, connectionId),
      "FISCAL_CONNECTION", connection, expectedVersion, userId); }
    catch (e) { if (e instanceof FiscalWriteConflict) throw new AppError(409, "FISCAL_CONNECTION_VERSION_CONFLICT"); throw e; }
    return publicConnection(connection);
  }
  static async listConnections(orgId: string, input: z.input<typeof ListFiscalConnectionsRequestSchema>) {
    tenant(orgId); const request = ListFiscalConnectionsRequestSchema.parse(input);
    const result = await FiscalRepository.listConnections(orgId, request.environment, request.limit, request.cursor);
    return { items: result.items.map(publicConnection), nextCursor: result.nextCursor };
  }
  static async getCertification(orgId: string, input: z.input<typeof FiscalSourceRequestSchema>) {
    tenant(orgId); const source = FiscalSourceRequestSchema.parse(input);
    const cert = await FiscalRepository.getCertification(orgId, source);
    if (!cert) throw new AppError(404, "FISCAL_CERTIFICATION_NOT_FOUND");
    return publicCertification(cert);
  }
  static async readiness(orgId: string, input: z.input<typeof PrepareFiscalCertificationRequestSchema>) {
    tenant(orgId); const request = PrepareFiscalCertificationRequestSchema.parse(input);
    return (await this.snapshot(orgId, request, request.preparation)).snapshot.readiness;
  }
  static async prepare(orgId: string, userId: string, input: z.input<typeof PrepareFiscalCertificationRequestSchema>) {
    tenant(orgId); actor(userId); const request = PrepareFiscalCertificationRequestSchema.parse(input);
    const hash = intent("CREATE", request);
    const replay = await this.replay(orgId, request.clientRequestId, hash);
    if (replay) return publicCertification(replay);
    if (await FiscalRepository.getCertification(orgId, request)) throw new AppError(409, "FISCAL_CERTIFICATION_ALREADY_EXISTS");
    const { snapshot, credentialAlias } = await this.snapshot(orgId, request, request.preparation);
    const now = snapshot.preparedAt;
    const data = FiscalCertificationInternalSchema.parse({ id: randomUUID(), country: "BJ", provider: "BENIN_E_MECEF",
      environment: request.environment, sourceDocumentType: request.sourceDocumentType, sourceDocumentId: request.sourceDocumentId,
      sourceVersion: snapshot.source.sourceVersion, sourceDigest: snapshot.source.sourceDigest, status: "PREPARED",
      totalsComparison: "NOT_RUN", preparationSnapshot: snapshot, credentialAliasSnapshot: credentialAlias,
      version: 1, createdAt: now, updatedAt: now });
    return this.commit(orgId, userId, data, 0, request.clientRequestId, hash);
  }
  static async revise(orgId: string, userId: string, input: z.input<typeof ReviseFiscalCertificationRequestSchema>) {
    tenant(orgId); actor(userId); const request = ReviseFiscalCertificationRequestSchema.parse(input);
    const hash = intent("REVISE", request);
    const replay = await this.replay(orgId, request.clientRequestId, hash);
    if (replay) return publicCertification(replay);
    const previous = await FiscalRepository.getCertification(orgId, request);
    if (!previous) throw new AppError(404, "FISCAL_CERTIFICATION_NOT_FOUND");
    assertLocallyEditable(previous);
    if (previous.version !== request.expectedVersion) throw new AppError(409, "FISCAL_CERTIFICATION_VERSION_CONFLICT");
    const source = previous.preparationSnapshot.source;
    const { snapshot, credentialAlias } = await this.snapshot(orgId, { ...request,
      originalInvoiceId: source.sourceDocumentType === "CREDIT_NOTE" ? source.originalInvoiceId : undefined }, request.preparation);
    if (snapshot.source.sourceDigest !== previous.sourceDigest) throw new AppError(409, "FISCAL_SOURCE_CHANGED");
    const data = FiscalCertificationInternalSchema.parse({ ...previous, preparationSnapshot: snapshot,
      credentialAliasSnapshot: credentialAlias, version: previous.version + 1, updatedAt: snapshot.preparedAt });
    return this.commit(orgId, userId, data, request.expectedVersion, request.clientRequestId, hash);
  }
  private static async replay(orgId: string, commandId: string, hash: string) {
    const command = await FiscalRepository.getCommand(orgId, commandId);
    if (!command) return undefined;
    if (command.intentHash !== hash) throw new AppError(409, "FISCAL_COMMAND_INTENT_CONFLICT");
    return FiscalRepository.getRevision(orgId, command, command.version);
  }
  private static async commit(orgId: string, userId: string, data: FiscalCertificationInternal, expectedVersion: number,
    commandId: string, hash: string) {
    try { await FiscalRepository.savePreparation(orgId, data, expectedVersion, commandId, hash, userId); }
    catch (e) {
      if (!(e instanceof FiscalWriteConflict)) throw e;
      const replay = await this.replay(orgId, commandId, hash);
      if (replay) return publicCertification(replay);
      throw new AppError(409, expectedVersion === 0 ? "FISCAL_CERTIFICATION_ALREADY_EXISTS" : "FISCAL_CERTIFICATION_VERSION_CONFLICT");
    }
    console.info("[FISCAL_LOCAL_ACTION]", { orgId, certificationId: data.id, environment: data.environment,
      sourceDocumentType: data.sourceDocumentType, sourceDocumentId: data.sourceDocumentId,
      action: expectedVersion === 0 ? "PREPARED" : "PREPARATION_UPDATED", status: data.status, version: data.version });
    return publicCertification(data);
  }
  private static async snapshot(orgId: string, request: FiscalSourceRequest & { originalInvoiceId?: string }, fiscal: BeninPreparationInput) {
    const source = await SalesFiscalSourceService.getIssuedDocument({ orgId, sourceDocumentType: request.sourceDocumentType,
      sourceDocumentId: request.sourceDocumentId, originalInvoiceId: request.originalInvoiceId });
    if (source.orgId !== orgId || source.sourceDocumentId !== request.sourceDocumentId || source.sourceDocumentType !== request.sourceDocumentType) throw new AppError(404, "FISCAL_SOURCE_NOT_FOUND");
    const profile = await FiscalRepository.getProfile(orgId);
    const connection = fiscal.connectionId ? await FiscalRepository.getConnection(orgId, request.environment, fiscal.connectionId) : undefined;
    if (connection && connection.environment !== request.environment) throw new AppError(409, "FISCAL_ENVIRONMENT_MISMATCH");
    if (fiscal.connectionId && !connection) {
      const other = await FiscalRepository.getConnection(orgId, request.environment === "TEST" ? "PRODUCTION" : "TEST", fiscal.connectionId);
      if (other) throw new AppError(409, "FISCAL_ENVIRONMENT_MISMATCH");
    }
    const lineIds = new Set(source.lines.map(line => line.id));
    if (new Set(fiscal.lines.map(line => line.sourceLineId)).size !== fiscal.lines.length || fiscal.lines.some(line => !lineIds.has(line.sourceLineId))) throw new AppError(400, "FISCAL_CLASSIFICATION_INVALID");
    if (fiscal.documentType) {
      const credit = source.sourceDocumentType === "CREDIT_NOTE";
      if ((credit ? !["FA", "EA"].includes(fiscal.documentType) : !["FV", "EV"].includes(fiscal.documentType)) ||
        (fiscal.tradeClassification && (fiscal.tradeClassification === "EXPORT") !== ["EV", "EA"].includes(fiscal.documentType))) throw new AppError(400, "FISCAL_CLASSIFICATION_INVALID");
    }
    let originalCertification: z.infer<typeof FiscalPreparationSnapshotSchema>["originalCertification"];
    if (source.sourceDocumentType === "CREDIT_NOTE") {
      const original = await FiscalRepository.getCertification(orgId, { environment: request.environment, sourceDocumentType: "INVOICE", sourceDocumentId: source.originalInvoiceId });
      const type = original?.preparationSnapshot.fiscal.documentType;
      if (original?.status === "CERTIFIED" && original.environment === request.environment && original.sourceDocumentType === "INVOICE" &&
        original.sourceDocumentId === source.originalInvoiceId && original.providerEvidence?.securityElements && (type === "FV" || type === "EV")) {
        if (fiscal.documentType && fiscal.documentType !== (type === "FV" ? "FA" : "EA")) throw new AppError(400, "FISCAL_CLASSIFICATION_INVALID");
        originalCertification = { certificationId: original.id, sourceDocumentId: original.sourceDocumentId, version: original.version,
          documentType: type, codeMECeFDGI: original.providerEvidence.securityElements.codeMECeFDGI, environment: original.environment };
      }
    }
    const issues: FiscalLocalReadiness["issues"] = [];
    const issue = (code: FiscalLocalReadiness["issues"][number]["code"], sourceLineId?: string) => issues.push({ code, ...(sourceLineId ? { sourceLineId } : {}) });
    if (!profile) issue("FISCAL_PROFILE_MISSING");
    if (!profile?.sellerIfu) issue("SELLER_IFU_MISSING");
    if (!profile?.legalName || !profile.address) issue("SELLER_LEGAL_IDENTITY_INCOMPLETE");
    if (!connection) issue("CONNECTION_MISSING");
    if (!connection?.credentialAlias) issue("CREDENTIAL_REFERENCE_MISSING");
    if (!connection?.nim) issue("CONNECTION_NIM_MISSING");
    if (!fiscal.documentType || !fiscal.tradeClassification || !fiscal.classificationEvidence) issue("FISCAL_CLASSIFICATION_INCOMPLETE");
    for (const line of source.lines) {
      const classification = fiscal.lines.find(c => c.sourceLineId === line.id);
      if (!classification?.taxGroup || !classification.classificationEvidence) issue("FISCAL_CLASSIFICATION_INCOMPLETE", line.id);
    }
    if (!fiscal.buyerIdentity || (fiscal.buyerIdentity.kind === "BJ_IFU" && !fiscal.buyerIdentity.evidence)) issue("BUYER_FISCAL_IDENTITY_INCOMPLETE");
    if (!fiscal.operator) issue("OPERATOR_INCOMPLETE");
    if (!fiscal.paymentDeclaration) issue("PAYMENT_DECLARATION_INCOMPLETE");
    if (!fiscal.aib) issue("AIB_CLASSIFICATION_INCOMPLETE");
    if (source.sourceDocumentType === "CREDIT_NOTE" && !originalCertification) issue("ORIGINAL_FISCAL_CERTIFICATION_REQUIRED");
    const localInputsComplete = issues.length === 0;
    issue("CURRENCY_PROVIDER_CONFIRMATION_REQUIRED"); issue("PROVIDER_MAPPING_NOT_ENABLED");
    const readiness = FiscalLocalReadinessSchema.parse({ kind: "LOCAL_READINESS", localInputsComplete, providerMutationEnabled: false, issues });
    const snapshot = FiscalPreparationSnapshotSchema.parse({ schemaVersion: 1, integrationVersion: "S4B-1", environment: request.environment,
      source, seller: profile ?? null, connection: connection ? publicConnection(connection) : null, fiscal,
      originalCertification, readiness, preparedAt: new Date().toISOString() });
    return { snapshot, credentialAlias: connection?.credentialAlias };
  }
}
