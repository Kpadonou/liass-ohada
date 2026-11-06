import {
  fiscalAttemptStateSchema,
  FiscalAttemptState,
} from "../../core/fiscal-attempt-state";
import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import { z } from "zod";
import {
  FiscalHttpTransport,
  nodeFetchFiscalHttpTransport,
} from "../http-transport";

export const BENIN_EMECEF_TEST_BASE_URL =
  "https://developper.impots.bj/sygmef-emcf";
import * as dto from "./invoice-dtos";
export { BeninInvoiceRequest } from "./invoice-dtos";

// Single-process pilot capability. Never recreate after an unknown outcome.
// Durable cross-process deduplication is deliberately outside this adapter.
export class BeninInvoiceAttempt {
  private used = false;
  claim(): void {
    if (this.used) throw new BeninEMecefConnectorError("DUPLICATE_ATTEMPT");
    this.used = true;
  }
}
const submittedInvoices = new Set<string>();
const createdInvoices = new WeakMap<
  object,
  {
    invoice: dto.BeninInvoiceRequest;
    uid: string;
    total: number;
    used: boolean;
  }
>();
export interface BeninPreparedConfirmation {
  readonly kind: "BENIN_TEST_PREPARED_CONFIRMATION";
  readonly invoiceType: "FV" | "FA" | "EV" | "EA" | "NA";
  readonly operatorEvidence: "PRESENT" | "ABSENT";
}

export interface BeninExpectedFiscalTotals {
  readonly ta: number;
  readonly tb: number;
  readonly tc: number;
  readonly td: number;
  readonly taa: number;
  readonly tab: number;
  readonly tac: number;
  readonly tad: number;
  readonly tae: number;
  readonly taf: number;
  readonly hab: number;
  readonly had: number;
  readonly vab: number;
  readonly vad: number;
  readonly aib: number;
  readonly ts: number;
  readonly total: number;
}
const preparedConfirmations = new WeakMap<
  BeninPreparedConfirmation,
  {
    invoice: dto.BeninInvoiceRequest;
    uid: string;
    used: boolean;
  }
>();
const STATUS_PATH = "/api/info/status";
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 64 * 1024;

const optionalNullableText = z.string().nullable().optional();
const emcfInfoSchema = z
  .object({
    nim: optionalNullableText,
    status: optionalNullableText,
    shopName: optionalNullableText,
    address1: optionalNullableText,
    address2: optionalNullableText,
    address3: optionalNullableText,
    contact1: optionalNullableText,
    contact2: optionalNullableText,
    contact3: optionalNullableText,
  })
  .strict();
const statusResponseSchema = z
  .object({
    status: z.boolean().optional(),
    version: optionalNullableText,
    ifu: optionalNullableText,
    nim: optionalNullableText,
    tokenValid: z.string().datetime({ offset: true }).optional(),
    serverDateTime: z.string().datetime({ offset: true }).optional(),
    emcfList: z.array(emcfInfoSchema).nullable().optional(),
  })
  .strict();

export type BeninEMecefConnectorErrorCode =
  | "INVALID_PAYLOAD"
  | "DUPLICATE_ATTEMPT"
  | "UNKNOWN_OUTCOME"
  | "PROVIDER_REJECTED"
  | "RECONCILIATION_FAILED"
  | "MISSING_CREDENTIAL"
  | "ENVIRONMENT_NOT_ALLOWED"
  | "AUTHENTICATION_FAILED"
  | "ACCESS_FORBIDDEN"
  | "TIMEOUT"
  | "NETWORK_FAILURE"
  | "MALFORMED_RESPONSE"
  | "UNEXPECTED_HTTP_STATUS";

export interface BeninEMecefValidationIssue {
  readonly path: string;
  readonly expected: string;
  readonly actual: string;
  readonly category:
    | "MISSING_FIELD"
    | "INVALID_TYPE"
    | "UNKNOWN_FIELD"
    | "VALIDATION";
  readonly observedCode?: string;
}

export interface BeninEMecefProviderDiagnostic {
  readonly operation:
    | "GET_INVOICE"
    | "CREATE_INVOICE"
    | "CONFIRM_INVOICE"
    | "CANCEL_INVOICE"
    | "OTHER";
  readonly httpStatus: number;
  readonly providerErrorCode: string;
  readonly rejectionCategory: "PROVIDER_ERROR_CODE";
}

const safeMessages: Record<BeninEMecefConnectorErrorCode, string> = {
  INVALID_PAYLOAD: "The TEST invoice input is invalid or unsupported.",
  DUPLICATE_ATTEMPT:
    "This TEST invoice attempt has already been submitted. Reconcile before further action.",
  UNKNOWN_OUTCOME:
    "The TEST mutation outcome is unknown. Do not resubmit; reconcile with the provider.",
  PROVIDER_REJECTED: "The TEST provider rejected the operation.",
  RECONCILIATION_FAILED:
    "The TEST invoice does not reconcile. Confirmation is blocked.",
  MISSING_CREDENTIAL: "The TEST credential is unavailable.",
  ENVIRONMENT_NOT_ALLOWED: "This connector supports TEST only.",
  AUTHENTICATION_FAILED: "The TEST provider rejected authentication.",
  ACCESS_FORBIDDEN: "The TEST provider denied access.",
  TIMEOUT: "The TEST provider request timed out.",
  NETWORK_FAILURE: "The TEST provider could not be reached securely.",
  MALFORMED_RESPONSE: "The TEST provider returned an invalid response.",
  UNEXPECTED_HTTP_STATUS: "The TEST provider returned an unexpected status.",
};

export class BeninEMecefConnectorError extends Error {
  constructor(
    readonly code: BeninEMecefConnectorErrorCode,
    readonly httpStatus?: number,
    readonly validationIssues?: readonly BeninEMecefValidationIssue[],
    readonly providerDiagnostic?: BeninEMecefProviderDiagnostic,
  ) {
    super(safeMessages[code]);
    this.name = "BeninEMecefConnectorError";
  }
}

export interface BeninEMecefStatusSummary {
  environment: "TEST";
  provider: "BENIN_E_MECEF";
  reachable: true;
  serviceAvailable: boolean | null;
  apiVersion: string | null;
  tokenValidUntil: string | null;
  serverDateTime: string | null;
  configuredDeviceCount: number | null;
}

export interface GetBeninEMecefStatusInput {
  environment: "TEST" | "PRODUCTION";
  credential: string | undefined;
}

export interface BeninEMecefTestAdapterOptions {
  transport?: FiscalHttpTransport;
  timeoutMs?: number;
}

export class BeninEMecefTestAdapter {
  private readonly transport: FiscalHttpTransport;
  private readonly timeoutMs: number;

  constructor(options: BeninEMecefTestAdapterOptions = {}) {
    this.transport = options.transport ?? nodeFetchFiscalHttpTransport;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (!Number.isInteger(this.timeoutMs) || this.timeoutMs < 1) {
      throw new TypeError("timeoutMs must be a positive integer");
    }
  }

  async getStatus(
    input: GetBeninEMecefStatusInput,
  ): Promise<BeninEMecefStatusSummary> {
    const parsed = {
      data: await this.request(input, "GET", STATUS_PATH, statusResponseSchema),
    };

    return {
      environment: "TEST",
      provider: "BENIN_E_MECEF",
      reachable: true,
      serviceAvailable: parsed.data.status ?? null,
      apiVersion: parsed.data.version ?? null,
      tokenValidUntil: parsed.data.tokenValid ?? null,
      serverDateTime: parsed.data.serverDateTime ?? null,
      configuredDeviceCount: parsed.data.emcfList?.length ?? null,
    };
  }
  private async request<T>(
    input: GetBeninEMecefStatusInput,
    method: "GET" | "POST" | "PUT",
    path: string,
    schema: z.ZodType<T>,
    body?: unknown,
  ): Promise<T> {
    if (input.environment !== "TEST") {
      throw new BeninEMecefConnectorError("ENVIRONMENT_NOT_ALLOWED");
    }
    if (!input.credential?.trim() || /[\r\n]/.test(input.credential)) {
      throw new BeninEMecefConnectorError("MISSING_CREDENTIAL");
    }

    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.timeoutMs);

    let response;
    try {
      response = await this.transport({
        method,
        url: `${BENIN_EMECEF_TEST_BASE_URL}${path}`,
        headers: {
          Accept: "application/json",
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
          Authorization: `Bearer ${input.credential}`,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
    } catch {
      throw new BeninEMecefConnectorError(
        timedOut ? "TIMEOUT" : "NETWORK_FAILURE",
      );
    } finally {
      clearTimeout(timeout);
    }

    if (response.status === 401) {
      throw new BeninEMecefConnectorError("AUTHENTICATION_FAILED", 401);
    }
    if (response.status === 403) {
      throw new BeninEMecefConnectorError("ACCESS_FORBIDDEN", 403);
    }
    if (response.status !== 200) {
      throw new BeninEMecefConnectorError(
        "UNEXPECTED_HTTP_STATUS",
        response.status,
      );
    }
    if (Buffer.byteLength(response.body, "utf8") > MAX_RESPONSE_BYTES) {
      throw new BeninEMecefConnectorError("MALFORMED_RESPONSE", 200);
    }

    let decoded: unknown;
    try {
      decoded = JSON.parse(response.body);
    } catch {
      throw new BeninEMecefConnectorError("MALFORMED_RESPONSE", 200);
    }

    const rejection = z
      .union([
        dto.InvoiceResponseDtoSchema,
        dto.InvoiceDetailsDtoSchema,
        dto.SecurityElementsDtoSchema,
      ])
      .safeParse(decoded);
    if (rejection.success && rejection.data.errorCode)
      throw providerRejected(method, path, rejection.data.errorCode);
    const parsed = schema.safeParse(decoded);
    if (!parsed.success)
      throw new BeninEMecefConnectorError(
        "MALFORMED_RESPONSE",
        200,
        sanitizeValidationIssues(decoded, parsed.error.issues),
      );
    if (
      parsed.data &&
      typeof parsed.data === "object" &&
      "errorCode" in parsed.data &&
      parsed.data.errorCode
    ) {
      throw providerRejected(method, path, parsed.data.errorCode);
    }
    return parsed.data;
  }

  getTaxGroups(input: GetBeninEMecefStatusInput) {
    return this.request(
      input,
      "GET",
      "/api/info/taxGroups",
      dto.TaxGroupsDtoSchema,
    );
  }
  getInvoiceTypes(input: GetBeninEMecefStatusInput) {
    return this.request(
      input,
      "GET",
      "/api/info/invoiceTypes",
      z.array(dto.InvoiceTypeDtoSchema),
    );
  }
  getPaymentTypes(input: GetBeninEMecefStatusInput) {
    return this.request(
      input,
      "GET",
      "/api/info/paymentTypes",
      z.array(dto.PaymentTypeDtoSchema),
    );
  }
  private uidPath(uid: string) {
    if (typeof uid !== "string" || !uid.trim() || uid.length > 256) {
      throw new BeninEMecefConnectorError("INVALID_PAYLOAD");
    }
    return `/api/invoice/${encodeURIComponent(uid)}`;
  }
  getInvoice(input: GetBeninEMecefStatusInput, uid: string) {
    return this.request(
      input,
      "GET",
      this.uidPath(uid),
      dto.InvoiceDetailsDtoSchema,
    );
  }
  private async mutate<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (
        error instanceof BeninEMecefConnectorError &&
        [
          "ENVIRONMENT_NOT_ALLOWED",
          "MISSING_CREDENTIAL",
          "PROVIDER_REJECTED",
        ].includes(error.code)
      )
        throw error;
      throw new BeninEMecefConnectorError("UNKNOWN_OUTCOME");
    }
  }

  async createInvoice(
    input: GetBeninEMecefStatusInput,
    attempt: BeninInvoiceAttempt,
    invoice: dto.BeninInvoiceRequest,
    expected: { itemTotals: number[]; total: number },
  ) {
    const parsed = validateInvoiceRequest(invoice, expected);
    if (input.environment !== "TEST")
      throw new BeninEMecefConnectorError("ENVIRONMENT_NOT_ALLOWED");
    if (!input.credential?.trim())
      throw new BeninEMecefConnectorError("MISSING_CREDENTIAL");
    const fingerprint = createHash("sha256")
      .update(input.credential)
      .update(JSON.stringify(parsed.data))
      .digest("hex");
    if (submittedInvoices.has(fingerprint))
      throw new BeninEMecefConnectorError("DUPLICATE_ATTEMPT");
    attempt.claim();
    submittedInvoices.add(fingerprint);
    const result = await this.mutate(() =>
      this.request(
        input,
        "POST",
        "/api/invoice",
        dto.InvoiceResponseDtoSchema.extend({
          uid: z.string().min(1),
          total: z.number().int().safe(),
        }),
        parsed.data,
      ),
    );
    // Preserve the UID even on a mismatch so the caller can inspect it. Never auto-confirm/cancel.
    const created = { ...result, reconciled: result.total === expected.total };
    createdInvoices.set(created, {
      invoice: structuredClone(parsed.data),
      uid: result.uid,
      total: expected.total,
      used: false,
    });
    return created;
  }

  async confirmInvoice(
    input: GetBeninEMecefStatusInput,
    uid: string,
    invoice: dto.BeninInvoiceRequest,
    expected: { itemTotals: number[]; total: number },
    created: { uid: string; total: number; reconciled: boolean },
  ) {
    const original = createdInvoices.get(created);
    if (
      !original ||
      original.used ||
      original.uid !== uid ||
      !sameInvoice(original.invoice, invoice) ||
      original.total !== expected.total ||
      created.uid !== uid ||
      !created.reconciled ||
      created.total !== expected.total
    ) {
      throw new BeninEMecefConnectorError("RECONCILIATION_FAILED");
    }
    const details = await this.getInvoice(input, uid);
    // Compare all item/payment fields, independent of JSON property ordering.
    if (!sameInvoice(details, invoice))
      throw new BeninEMecefConnectorError("RECONCILIATION_FAILED");
    original.used = true;
    const security = await this.mutate(() =>
      this.request(
        input,
        "PUT",
        `${this.uidPath(uid)}/confirm`,
        securitySchema,
      ),
    );
    return { uid, ...security };
  }

  async confirmCreatedInvoice(
    input: GetBeninEMecefStatusInput,
    uid: string,
    invoice: dto.BeninInvoiceRequest,
    expected: { itemTotals: number[]; total: number },
    created: z.infer<typeof dto.InvoiceResponseDtoSchema> & {
      uid: string;
      total: number;
      reconciled: boolean;
    },
    expectedFiscalTotals: BeninExpectedFiscalTotals,
  ) {
    const original = createdInvoices.get(created);
    const fiscalFields: (keyof BeninExpectedFiscalTotals)[] = [
      "ta",
      "tb",
      "tc",
      "td",
      "taa",
      "tab",
      "tac",
      "tad",
      "tae",
      "taf",
      "hab",
      "had",
      "vab",
      "vad",
      "aib",
      "ts",
      "total",
    ];
    if (
      !original ||
      original.used ||
      original.uid !== uid ||
      !sameInvoice(original.invoice, invoice) ||
      original.total !== expected.total ||
      created.uid !== uid ||
      !created.reconciled ||
      created.total !== expected.total ||
      fiscalFields.some(
        (field) => created[field] !== expectedFiscalTotals[field],
      )
    ) {
      throw new BeninEMecefConnectorError("RECONCILIATION_FAILED");
    }
    original.used = true;
    const security = await this.mutate(() =>
      this.request(
        input,
        "PUT",
        `${this.uidPath(uid)}/confirm`,
        securitySchema,
      ),
    );
    return { uid, ...security };
  }

  /** Internal durable binding: caller must have persisted this CONFIRM reservation.
   * No process-local capability or invoice payload is reconstructed or resent.
   */
  async confirmDurableInvoice(
    input: GetBeninEMecefStatusInput,
    evidence: FiscalAttemptState,
  ) {
    const state = fiscalAttemptStateSchema.parse(evidence);
    if (
      input.environment !== "TEST" ||
      state.identity.environment !== "TEST" ||
      state.provider !== "BENIN_EMECEF_TEST" ||
      state.status !== "CONFIRM_IN_FLIGHT" ||
      !state.uid ||
      state.providerTotal !== state.expectedTotal
    )
      throw new BeninEMecefConnectorError("RECONCILIATION_FAILED");
    const security = await this.mutate(() =>
      this.request(
        input,
        "PUT",
        `${this.uidPath(state.uid!)}/confirm`,
        securitySchema,
      ),
    );
    return { uid: state.uid, ...security };
  }

  async cancelInvoice(input: GetBeninEMecefStatusInput, uid: string) {
    const path = `${this.uidPath(uid)}/cancel`;
    return {
      uid,
      ...(await this.mutate(() =>
        this.request(input, "PUT", path, securitySchema),
      )),
    };
  }

  async prepareExistingInvoiceConfirmation(
    input: GetBeninEMecefStatusInput,
    uid: string,
    invoice: dto.BeninInvoiceRequest,
    expected: { itemTotals: number[]; total: number },
    createdEvidence: { uid: string; total: number; reconciled: true },
  ): Promise<BeninPreparedConfirmation> {
    const parsed = validateInvoiceRequest(invoice, expected);
    if (
      createdEvidence.uid !== uid ||
      createdEvidence.total !== expected.total
    ) {
      throw new BeninEMecefConnectorError("RECONCILIATION_FAILED");
    }
    const details = await this.getInvoiceForTestConfirmation(input, uid);
    if (!sameInvoice(details, parsed.data, true)) {
      throw new BeninEMecefConnectorError("RECONCILIATION_FAILED");
    }
    const capability: BeninPreparedConfirmation = {
      kind: "BENIN_TEST_PREPARED_CONFIRMATION",
      invoiceType: details.type!,
      operatorEvidence: details.operator ? "PRESENT" : "ABSENT",
    };
    preparedConfirmations.set(capability, {
      invoice: structuredClone(parsed.data),
      uid,
      used: false,
    });
    return capability;
  }

  async confirmPreparedInvoice(
    input: GetBeninEMecefStatusInput,
    capability: BeninPreparedConfirmation,
  ) {
    const prepared = preparedConfirmations.get(capability);
    if (!prepared || prepared.used) {
      throw new BeninEMecefConnectorError("RECONCILIATION_FAILED");
    }
    const details = await this.getInvoiceForTestConfirmation(
      input,
      prepared.uid,
    );
    if (!sameInvoice(details, prepared.invoice, true)) {
      throw new BeninEMecefConnectorError("RECONCILIATION_FAILED");
    }
    prepared.used = true;
    const security = await this.mutate(() =>
      this.request(
        input,
        "PUT",
        `${this.uidPath(prepared.uid)}/confirm`,
        securitySchema,
      ),
    );
    return { uid: prepared.uid, ...security };
  }

  private getInvoiceForTestConfirmation(
    input: GetBeninEMecefStatusInput,
    uid: string,
  ) {
    return this.request(
      input,
      "GET",
      this.uidPath(uid),
      dto.InvoiceDetailsDtoSchema.extend({
        type: z.preprocess(
          (value) => (typeof value === "string" ? value.trim() : value),
          z.enum(["FV", "FA", "EV", "EA", "NA"]).optional(),
        ),
      }),
    );
  }
}

function providerRejected(
  method: "GET" | "POST" | "PUT",
  path: string,
  errorCode: unknown,
): BeninEMecefConnectorError {
  const providerErrorCode =
    typeof errorCode === "string" && /^[A-Za-z0-9._-]{1,64}$/.test(errorCode)
      ? errorCode
      : "UNRECOGNIZED_FORMAT";
  const operation =
    method === "POST" && path === "/api/invoice"
      ? "CREATE_INVOICE"
      : method === "GET" && /^\/api\/invoice\/[^/]+$/.test(path)
        ? "GET_INVOICE"
        : method === "PUT" && path.endsWith("/confirm")
          ? "CONFIRM_INVOICE"
          : method === "PUT" && path.endsWith("/cancel")
            ? "CANCEL_INVOICE"
            : "OTHER";
  return new BeninEMecefConnectorError("PROVIDER_REJECTED", 200, undefined, {
    operation,
    httpStatus: 200,
    providerErrorCode,
    rejectionCategory: "PROVIDER_ERROR_CODE",
  });
}

function sanitizeValidationIssues(
  decoded: unknown,
  issues: readonly z.core.$ZodIssue[],
): readonly BeninEMecefValidationIssue[] {
  return Object.freeze(
    issues.slice(0, 20).map((issue) => {
      let actual: unknown = decoded;
      for (const segment of issue.path) {
        if (!actual || typeof actual !== "object") {
          actual = undefined;
          break;
        }
        actual = (actual as Record<PropertyKey, unknown>)[segment];
      }
      const actualType =
        actual === undefined
          ? "missing"
          : actual === null
            ? "null"
            : Array.isArray(actual)
              ? "array"
              : typeof actual;
      const expected =
        "expected" in issue && typeof issue.expected === "string"
          ? issue.expected
          : issue.code;
      return Object.freeze({
        path: issue.path.length ? issue.path.map(String).join(".") : "$",
        expected,
        actual: actualType,
        category:
          issue.code === "unrecognized_keys"
            ? ("UNKNOWN_FIELD" as const)
            : actual === undefined
              ? ("MISSING_FIELD" as const)
              : issue.code === "invalid_type"
                ? ("INVALID_TYPE" as const)
                : ("VALIDATION" as const),
        ...(issue.path.length === 1 &&
        issue.path[0] === "type" &&
        typeof actual === "string" &&
        /^[A-Za-z]{1,8}$/.test(actual.trim())
          ? { observedCode: actual.trim() }
          : {}),
      });
    }),
  );
}

function validateInvoiceRequest(
  invoice: dto.BeninInvoiceRequest,
  expected: { itemTotals: number[]; total: number },
) {
  // Pilot supports explicit tax groups and whole-unit, tax-inclusive prices only.
  const parsed = dto.InvoiceRequestDataDtoSchema.safeParse(invoice);
  if (
    !parsed.success ||
    !invoice.ifu?.trim() ||
    invoice.type !== "FV" ||
    invoice.aib !== undefined ||
    !invoice.operator?.name?.trim() ||
    !invoice.items?.length ||
    !invoice.payment?.length ||
    !Number.isSafeInteger(expected.total) ||
    expected.total <= 0 ||
    expected.itemTotals.length !== invoice.items.length
  )
    throw new BeninEMecefConnectorError("INVALID_PAYLOAD");
  let total = 0n;
  for (const [index, item] of invoice.items.entries()) {
    if (
      !item.name?.trim() ||
      item.price === undefined ||
      item.quantity === undefined ||
      !item.taxGroup ||
      item.price < 0 ||
      !Number.isSafeInteger(item.quantity) ||
      item.quantity <= 0 ||
      item.taxSpecific != null ||
      item.originalPrice != null ||
      item.priceModification != null
    ) {
      throw new BeninEMecefConnectorError("INVALID_PAYLOAD");
    }
    const amount = BigInt(item.price) * BigInt(item.quantity);
    if (
      !Number.isSafeInteger(expected.itemTotals[index]) ||
      amount !== BigInt(expected.itemTotals[index])
    ) {
      throw new BeninEMecefConnectorError("RECONCILIATION_FAILED");
    }
    total += amount;
  }
  const paid = invoice.payment.reduce((sum, payment) => {
    if (!payment.name || payment.amount === undefined || payment.amount < 0)
      throw new BeninEMecefConnectorError("INVALID_PAYLOAD");
    return sum + BigInt(payment.amount);
  }, 0n);
  if (total !== BigInt(expected.total) || paid !== total)
    throw new BeninEMecefConnectorError("RECONCILIATION_FAILED");
  return parsed;
}

const securitySchema = dto.SecurityElementsDtoSchema.extend({
  dateTime: z.string().min(1),
  qrCode: z.string().min(1),
  codeMECeFDGI: z.string().min(1),
  counters: z.string().min(1),
  nim: z.string().min(1),
});
function sameInvoice(
  details: unknown,
  invoice: dto.BeninInvoiceRequest,
  allowTestNa = false,
): boolean {
  const parsed = dto.InvoiceRequestDataDtoSchema.safeParse(invoice);
  if (!parsed.success || !details || typeof details !== "object") return false;
  const canonical = (value: unknown): string => {
    if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
    if (value && typeof value === "object")
      return JSON.stringify(
        Object.fromEntries(
          Object.entries(value)
            .filter(([, v]) => v != null)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, v]) => [k, canonical(v)]),
        ),
      );
    return JSON.stringify(value);
  };
  const {
    errorCode: _code,
    errorDesc: _desc,
    paymentUrl: _url,
    ...actual
  } = details as z.infer<typeof dto.InvoiceDetailsDtoSchema>;
  const expected = structuredClone(parsed.data);
  // Missing GET operator evidence is never converted into a verified operator.
  // All fiscal identity, item, tax, payment and amount fields remain exact.
  if (actual.operator === undefined) delete expected.operator;
  if (
    allowTestNa &&
    (actual as { type?: string }).type === "NA" &&
    expected.type === "FV"
  ) {
    delete actual.type;
    delete expected.type;
  }
  return canonical(actual) === canonical(expected);
}
