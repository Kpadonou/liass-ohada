import { randomUUID } from "node:crypto";
import { GetItemCommand, QueryCommand, TransactWriteItemsCommand, TransactWriteItemsCommandInput, AttributeValue } from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { mockClient } from "aws-sdk-client-mock";
import { dynamoClient } from "@/lambda/shared/dynamo-client";
import { KeyFactory } from "@/lambda/shared/key-builder";
import { SalesFiscalSourceService } from "@/lambda/domains/sales/references/sales-fiscal-source-service";
import { FiscalService, assertLocallyEditable } from "@/lambda/domains/fiscal-compliance/core/fiscal-service";
import { FiscalRepository, boundedFiscalItem } from "@/lambda/domains/fiscal-compliance/core/fiscal-repository";
import { FiscalCertificationInternalSchema } from "@/lambda/domains/fiscal-compliance/core/fiscal-persistence-model";
import { BeninPreparationInputSchema, FiscalCertificationStatusSchema, PrepareFiscalCertificationRequestSchema,
  CreateBeninConnectionRequestSchema, UpdateBeninConnectionRequestSchema } from "@liass-ohada/shared/fiscal-compliance";
import { source, request } from "./fixtures";

const aws = mockClient(dynamoClient);
let rows: Map<string, Record<string, AttributeValue>>;
const identity = (value: ReturnType<typeof request>) => ({ environment: value.environment, sourceDocumentType: value.sourceDocumentType, sourceDocumentId: value.sourceDocumentId });
const rowKey = (item: Record<string, AttributeValue>) => `${item.PK.S}|${item.SK.S}`;
const storedCertification = (environment = "TEST") => rows.get(`ORG#org-1|${KeyFactory.fiscalCertificationSK(environment, "INVOICE", "invoice-1")}`)!;

beforeEach(() => {
  jest.restoreAllMocks(); aws.reset(); rows = new Map();
  jest.spyOn(console, "info").mockImplementation(() => undefined);
  jest.spyOn(SalesFiscalSourceService, "getIssuedDocument").mockResolvedValue(source());
  aws.on(GetItemCommand).callsFake(async input => ({ Item: rows.get(rowKey(input.Key!)) }));
  aws.on(QueryCommand).callsFake(async input => {
    const values = unmarshall(input.ExpressionAttributeValues!);
    return { Items: [...rows.values()].filter(item => item.PK.S === values[":pk"] && item.SK.S?.startsWith(values[":prefix"])) };
  });
  aws.on(TransactWriteItemsCommand).callsFake(async (input: TransactWriteItemsCommandInput) => {
    const reasons = input.TransactItems!.map(operation => {
      const put = operation.Put!;
      const existing = rows.get(rowKey(put.Item!));
      const item = existing ? unmarshall(existing) : undefined;
      const values = put.ExpressionAttributeValues ? unmarshall(put.ExpressionAttributeValues) : {};
      const valid = put.ConditionExpression === "attribute_not_exists(PK)" ? !existing :
        !!item && item.entityType === values[":type"] && item.data.version === values[":version"] &&
        (!put.ConditionExpression?.includes("#status") || ["PREPARED", "UNPREPARED"].includes(item.data.status));
      return { Code: valid ? "None" : "ConditionalCheckFailed" };
    });
    if (reasons.some(r => r.Code === "ConditionalCheckFailed")) throw Object.assign(new Error("Condition failed"),
      { name: "TransactionCanceledException", CancellationReasons: reasons });
    for (const operation of input.TransactItems!) rows.set(rowKey(operation.Put!.Item!), operation.Put!.Item!);
    return {};
  });
});
afterAll(() => aws.restore());

test("profile is deterministic, optimistic and has an atomic actor audit", async () => {
  expect(await FiscalService.getProfile("org-1")).toBeNull();
  const profile = await FiscalService.putProfile("org-1", "user-1", { expectedVersion: 0, sellerIfu: "entered-not-remotely-validated", legalName: "Seller" });
  expect(profile.version).toBe(1);
  expect(await FiscalService.getProfile("org-2")).toBeNull();
  await expect(FiscalService.putProfile("org-1", "user-1", { expectedVersion: 0 })).rejects.toMatchObject({ messageCode: "FISCAL_PROFILE_VERSION_CONFLICT" });
  expect((await FiscalService.putProfile("org-1", "user-1", { expectedVersion: 1, legalName: "Changed" })).version).toBe(2);
  const tx = aws.commandCalls(TransactWriteItemsCommand)[0].args[0].input.TransactItems!;
  expect(tx).toHaveLength(2);
  expect(unmarshall(tx[1].Put!.Item!)).toMatchObject({ entityType: "FISCAL_CONFIGURATION_HISTORY", actorUserId: "user-1" });
  expect(aws.commandCalls(GetItemCommand).every(c => c.args[0].input.ConsistentRead)).toBe(true);
});

test("connections support multiple shops, isolate environments, redact aliases and version updates", async () => {
  const a = await FiscalService.createConnection("org-1", "user-1", { environment: "TEST", shopName: "First", credentialAlias: "shop_first" });
  const b = await FiscalService.createConnection("org-1", "user-1", { environment: "TEST", shopName: "Second" });
  await FiscalService.createConnection("org-1", "user-1", { environment: "PRODUCTION" });
  expect(a.connectionId).not.toBe(b.connectionId);
  expect(a).toMatchObject({ credentialConfigured: true, version: 1 });
  expect(JSON.stringify(a)).not.toContain("shop_first");
  expect((await FiscalService.listConnections("org-1", { environment: "TEST" })).items).toHaveLength(2);
  expect((await FiscalService.listConnections("org-2", { environment: "TEST" })).items).toHaveLength(0);
  await expect(FiscalService.getConnection("org-1", { environment: "PRODUCTION", connectionId: a.connectionId })).rejects.toMatchObject({ messageCode: "FISCAL_CONNECTION_NOT_FOUND" });
  const updated = await FiscalService.updateConnection("org-1", "user-1", { environment: "TEST", connectionId: a.connectionId }, { expectedVersion: 1, credentialAlias: null, shopName: "Updated" });
  expect(updated).toMatchObject({ version: 2, credentialConfigured: false });
  await expect(FiscalService.updateConnection("org-1", "user-1", { environment: "TEST", connectionId: a.connectionId }, { expectedVersion: 1 })).rejects.toMatchObject({ messageCode: "FISCAL_CONNECTION_VERSION_CONFLICT" });
  expect(UpdateBeninConnectionRequestSchema.safeParse({ expectedVersion: 2, environment: "PRODUCTION" }).success).toBe(false);
});

test.each(["org-2", "PRODUCTION"])("connection cursor cannot escape its tenant/environment: %s", async scope => {
  const cursor = Buffer.from(JSON.stringify({ PK: KeyFactory.orgKey(scope === "org-2" ? scope : "org-1"),
    SK: KeyFactory.fiscalConnectionSK(scope === "PRODUCTION" ? scope : "TEST", "connection-1") })).toString("base64url");
  await expect(FiscalService.listConnections("org-1", { environment: "TEST", cursor })).rejects.toMatchObject({ messageCode: "ERROR_INVALID_CURSOR" });
  expect(aws.commandCalls(QueryCommand)).toHaveLength(0);
});

test("local preparation freezes source values, reports incomplete inputs, and never produces provider evidence", async () => {
  const result = await FiscalService.prepare("org-1", "user-1", request());
  expect(result).toMatchObject({ status: "PREPARED", totalsComparison: "NOT_RUN", version: 1 });
  expect(result.preparationSnapshot.source).toEqual(source());
  expect(result.preparationSnapshot.fiscal.lines).toEqual([]);
  expect(result.preparationSnapshot.fiscal.buyerIdentity).toBeUndefined();
  expect(result.preparationSnapshot.source.lines[0]).toMatchObject({ unitPrice: "10.01", quantity: "2.5", taxRate: "18", totalMinor: "2954" });
  expect(result.preparationSnapshot.readiness).toMatchObject({ kind: "LOCAL_READINESS", localInputsComplete: false, providerMutationEnabled: false });
  expect(result.preparationSnapshot.readiness.issues).toEqual(expect.arrayContaining([
    { code: "FISCAL_PROFILE_MISSING" }, { code: "CURRENCY_PROVIDER_CONFIRMATION_REQUIRED" }, { code: "PROVIDER_MAPPING_NOT_ENABLED" },
    { code: "FISCAL_CLASSIFICATION_INCOMPLETE", sourceLineId: "line-1" },
  ]));
  expect(result).not.toHaveProperty("providerEvidence");
  const tx = aws.commandCalls(TransactWriteItemsCommand)[0].args[0].input.TransactItems!;
  expect(tx).toHaveLength(3);
  expect(tx.every(o => o.Put?.ConditionExpression === "attribute_not_exists(PK)")).toBe(true);
  expect(tx.map(o => unmarshall(o.Put!.Item!).entityType)).toEqual(["FISCAL_CERTIFICATION", "FISCAL_HISTORY", "FISCAL_COMMAND"]);
});

test("readiness is read only and cannot mistake a generic taxIdentifier for BJ IFU", async () => {
  await FiscalService.readiness("org-1", request());
  expect(aws.commandCalls(TransactWriteItemsCommand)).toHaveLength(0);
  const readiness = await FiscalService.readiness("org-1", request());
  expect(readiness.issues).toContainEqual({ code: "BUYER_FISCAL_IDENTITY_INCOMPLETE" });
});

test("complete local facts still leave currency and provider mapping gated; payment CREDIT and full-line specific tax stay exact", async () => {
  await FiscalService.putProfile("org-1", "user-1", { expectedVersion: 0, sellerIfu: "local-ifu", legalName: "Seller", address: "Cotonou" });
  const connection = await FiscalService.createConnection("org-1", "user-1", { environment: "TEST", nim: "local-nim", credentialAlias: "test_shop" });
  const input = request();
  input.preparation = { connectionId: connection.connectionId, documentType: "FV", tradeClassification: "DOMESTIC", classificationEvidence: "Reviewed local facts",
    lines: [{ sourceLineId: "line-1", taxGroup: "D", classificationEvidence: "Explicit exceptional regime", taxSpecificMinor: "19" }],
    aib: "B", buyerIdentity: { kind: "NO_IFU" }, operator: { id: "pos-1", name: "Operator" }, paymentDeclaration: [{ method: "CREDIT", amountMinor: "2954" }] };
  const result = await FiscalService.prepare("org-1", "user-1", input);
  expect(result.preparationSnapshot.readiness).toMatchObject({ localInputsComplete: true, providerMutationEnabled: false,
    issues: [{ code: "CURRENCY_PROVIDER_CONFIRMATION_REQUIRED" }, { code: "PROVIDER_MAPPING_NOT_ENABLED" }] });
  expect(result.preparationSnapshot.fiscal.lines[0]).toMatchObject({ taxGroup: "D", taxSpecificMinor: "19" });
  expect(result.preparationSnapshot.fiscal.paymentDeclaration).toEqual([{ method: "CREDIT", amountMinor: "2954" }]);
});

test("profile/connection edits cannot mutate snapshots; revision is explicit, versioned and preserves earlier command results", async () => {
  await FiscalService.putProfile("org-1", "user-1", { expectedVersion: 0, legalName: "Old seller" });
  const connection = await FiscalService.createConnection("org-1", "user-1", { environment: "TEST", shopName: "Old shop", credentialAlias: "old_shop" });
  const create = request(); create.preparation.connectionId = connection.connectionId;
  const first = await FiscalService.prepare("org-1", "user-1", create);
  await FiscalService.putProfile("org-1", "user-1", { expectedVersion: 1, legalName: "New seller" });
  await FiscalService.updateConnection("org-1", "user-1", { environment: "TEST", connectionId: connection.connectionId }, { expectedVersion: 1, shopName: "New shop", credentialAlias: "new_shop" });
  const read = await FiscalService.getCertification("org-1", identity(create));
  expect(read.preparationSnapshot.seller?.legalName).toBe("Old seller");
  expect(read.preparationSnapshot.connection?.shopName).toBe("Old shop");
  const revision = { environment: create.environment, sourceDocumentType: create.sourceDocumentType, sourceDocumentId: create.sourceDocumentId,
    clientRequestId: randomUUID(), expectedVersion: 1, preparation: create.preparation };
  const second = await FiscalService.revise("org-1", "user-1", revision);
  expect(second).toMatchObject({ id: first.id, version: 2 });
  expect(second.preparationSnapshot.seller?.legalName).toBe("New seller");
  expect(second.preparationSnapshot.connection?.shopName).toBe("New shop");
  expect(await FiscalService.prepare("org-1", "user-1", create)).toEqual(first);
  expect(await FiscalService.revise("org-1", "user-1", revision)).toEqual(second);
  await expect(FiscalService.revise("org-1", "user-1", { ...revision, clientRequestId: randomUUID() })).rejects.toMatchObject({ messageCode: "FISCAL_CERTIFICATION_VERSION_CONFLICT" });
  const calls = aws.commandCalls(TransactWriteItemsCommand);
  expect(calls[calls.length - 1].args[0].input.TransactItems![0].Put!.ConditionExpression).toContain("#data.#status");
  expect(JSON.stringify(second)).not.toContain("new_shop");
  expect(JSON.stringify(jest.mocked(console.info).mock.calls)).not.toContain("Old seller");
});

test("racing commands cannot create duplicate source certifications; replay and conflicting intent behave deterministically", async () => {
  const input = request();
  const [a, b] = await Promise.all([FiscalService.prepare("org-1", "user-1", input), FiscalService.prepare("org-1", "user-1", input)]);
  expect(a).toEqual(b);
  expect([...rows.values()].filter(row => unmarshall(row).entityType === "FISCAL_CERTIFICATION")).toHaveLength(1);
  await expect(FiscalService.prepare("org-1", "user-1", { ...input, preparation: { ...input.preparation, aib: "A" } })).rejects.toMatchObject({ messageCode: "FISCAL_COMMAND_INTENT_CONFLICT" });
  await expect(FiscalService.prepare("org-1", "user-1", { ...input, clientRequestId: randomUUID() })).rejects.toMatchObject({ messageCode: "FISCAL_CERTIFICATION_ALREADY_EXISTS" });
  const production = await FiscalService.prepare("org-1", "user-1", { ...input, environment: "PRODUCTION", clientRequestId: randomUUID() });
  expect(production.id).not.toBe(a.id);
  await expect(FiscalService.getCertification("org-2", identity(input))).rejects.toMatchObject({ messageCode: "FISCAL_CERTIFICATION_NOT_FOUND" });
});

test("a racing revision condition prevents partial history/command writes", async () => {
  const create = request(); await FiscalService.prepare("org-1", "user-1", create);
  const base = { environment: create.environment, sourceDocumentType: create.sourceDocumentType, sourceDocumentId: create.sourceDocumentId,
    expectedVersion: 1, preparation: create.preparation };
  const results = await Promise.allSettled([FiscalService.revise("org-1", "user-1", { ...base, clientRequestId: randomUUID() }),
    FiscalService.revise("org-1", "user-1", { ...base, clientRequestId: randomUUID() })]);
  expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
  expect([...rows.values()].filter(r => unmarshall(r).entityType === "FISCAL_HISTORY")).toHaveLength(2);
  expect([...rows.values()].filter(r => unmarshall(r).entityType === "FISCAL_COMMAND")).toHaveLength(2);
});

test("cross-environment connection selection is rejected before persistence", async () => {
  const connection = await FiscalService.createConnection("org-1", "user-1", { environment: "PRODUCTION" });
  const input = request(); input.preparation.connectionId = connection.connectionId;
  const count = aws.commandCalls(TransactWriteItemsCommand).length;
  await expect(FiscalService.prepare("org-1", "user-1", input)).rejects.toMatchObject({ messageCode: "FISCAL_ENVIRONMENT_MISMATCH" });
  expect(aws.commandCalls(TransactWriteItemsCommand)).toHaveLength(count);
});

test.each(FiscalCertificationStatusSchema.options.filter(s => !["UNPREPARED", "PREPARED"].includes(s)))("local edits reject remote state %s", status => {
  expect(() => assertLocallyEditable({ status })).toThrow("FISCAL_PREPARATION_NOT_EDITABLE");
});
test.each(["UNPREPARED", "PREPARED"] as const)("local state %s accepts preparation only without provider evidence", status => {
  expect(() => assertLocallyEditable({ status })).not.toThrow();
});

test.each(["providerUid", "securityElements", "codeMECeFDGI", "status", "providerEvidence", "qrCode"])("public input rejects injected %s", field => {
  expect(PrepareFiscalCertificationRequestSchema.safeParse({ ...request(), [field]: "injected" }).success).toBe(false);
  expect(BeninPreparationInputSchema.safeParse({ lines: [], [field]: "injected" }).success).toBe(false);
});
test.each(["Bearer secret", "eyJhbGciOiJIUzI1NiJ9.abc.def", "arn:aws:secretsmanager:region:account:secret:name"])("credential reference rejects secret/wire text %s", credentialAlias => {
  expect(CreateBeninConnectionRequestSchema.safeParse({ environment: "TEST", credentialAlias }).success).toBe(false);
});
test("bounded storage refuses oversized snapshots before any write and measures maximal supported descriptions", () => {
  expect(() => boundedFiscalItem({ text: "é".repeat(200000) })).toThrow("FISCAL_SNAPSHOT_TOO_LARGE");
  expect(() => boundedFiscalItem({ lines: Array.from({ length: 100 }, () => ({ description: "s".repeat(2000), evidence: "s".repeat(1000) })) })).not.toThrow();
});
test("CERTIFIED persistence requires positive totals and security evidence", async () => {
  await FiscalService.prepare("org-1", "user-1", request());
  const stored = unmarshall(storedCertification()).data;
  expect(FiscalCertificationInternalSchema.safeParse({ ...stored, status: "CERTIFIED" }).success).toBe(false);
});

test("unknown line ids, duplicates and incompatible commercial/fiscal type never persist", async () => {
  for (const preparation of [ { lines: [{ sourceLineId: "other" }] },
    { lines: [{ sourceLineId: "line-1" }, { sourceLineId: "line-1" }] }, { lines: [], documentType: "FA" as const },
    { lines: [], documentType: "FV" as const, tradeClassification: "EXPORT" as const } ]) {
    await expect(FiscalService.prepare("org-1", "user-1", { ...request(), preparation })).rejects.toMatchObject({ messageCode: "FISCAL_CLASSIFICATION_INVALID" });
  }
  expect(aws.commandCalls(TransactWriteItemsCommand)).toHaveLength(0);
});

test("commercial credit needs the same-environment original successful fiscal certification, not its commercial number", async () => {
  const originalInput = request(); originalInput.preparation.documentType = "FV";
  await FiscalService.prepare("org-1", "user-1", originalInput);
  const invoice = source();
  const creditSource = { ...invoice, sourceDocumentType: "CREDIT_NOTE" as const, sourceDocumentId: "credit-1",
    commercialNumber: "7", originalInvoiceId: "invoice-1", originalInvoiceNumber: "19", reason: "Correction",
    lines: invoice.lines.map(line => ({ ...line, originalInvoiceLineId: "line-1" })) };
  jest.mocked(SalesFiscalSourceService.getIssuedDocument).mockResolvedValue(creditSource);
  const credit = { ...request(), sourceDocumentType: "CREDIT_NOTE" as const, sourceDocumentId: "credit-1", originalInvoiceId: "invoice-1",
    preparation: { lines: [], documentType: "FA" as const } };
  const blocked = await FiscalService.readiness("org-1", credit);
  expect(blocked.issues).toContainEqual({ code: "ORIGINAL_FISCAL_CERTIFICATION_REQUIRED" });
  const row = unmarshall(storedCertification());
  const zeroTotals = Object.fromEntries(["ta", "tb", "tc", "td", "taa", "tab", "tac", "tad", "tae", "taf", "hab", "had", "vab", "vad", "aib", "ts", "total"].map(k => [k, "0"]));
  row.data = FiscalCertificationInternalSchema.parse({ ...row.data, status: "CERTIFIED", totalsComparison: "MATCH",
    providerEvidence: { uid: "fixture-uid", submissionSnapshot: { schemaVersion: 1, mappingVersion: "fixture", ifu: "fixture-ifu",
      type: "FV", items: [{ name: "fixture", price: "0", quantity: "1", taxGroup: "A" }], operator: { name: "fixture" } },
      totals: zeroTotals, securityElements: { codeMECeFDGI: "ORIGINAL-CODE-UNCHANGED", dateTime: "fixture-time", qrCode: "fixture-qr", counters: "fixture-counters", nim: "fixture-nim" } } });
  rows.set(rowKey(storedCertification()), marshall(row, { removeUndefinedValues: true }));
  const prepared = await FiscalService.prepare("org-1", "user-1", credit);
  expect(prepared.preparationSnapshot.originalCertification).toMatchObject({ codeMECeFDGI: "ORIGINAL-CODE-UNCHANGED", environment: "TEST", documentType: "FV" });
  expect(prepared.preparationSnapshot.originalCertification?.codeMECeFDGI).not.toBe("19");
  expect((await FiscalService.readiness("org-1", { ...credit, environment: "PRODUCTION" })).issues).toContainEqual({ code: "ORIGINAL_FISCAL_CERTIFICATION_REQUIRED" });
  await expect(FiscalService.readiness("org-1", { ...credit, preparation: { lines: [], documentType: "EA" } })).rejects.toMatchObject({ messageCode: "FISCAL_CLASSIFICATION_INVALID" });
});
