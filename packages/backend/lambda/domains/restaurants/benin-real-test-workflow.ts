import { hash, canonical, clean } from "@/lambda/shared/authority/integrity";
import { z } from "zod";
import {
  BeninEMecefTestAdapter,
  BeninInvoiceAttempt,
} from "../fiscal-compliance/providers/benin-emecef/benin-emecef-test-adapter";
import { InvoiceRequestDataDtoSchema } from "../fiscal-compliance/providers/benin-emecef/invoice-dtos";
import { FiscalAttemptStore } from "../fiscal-compliance/persistence/fiscal-attempt-store";
import { ConfirmationCapture } from "../fiscal-compliance/persistence/confirmation-capture";
import {
  nodeFetchFiscalHttpTransport,
  FiscalHttpTransport,
} from "../fiscal-compliance/providers/http-transport";
import {
  MockFiscalProvider,
  SyntheticFiscalOrchestrator,
  VerifiedFiscalPreparation,
} from "../fiscal-compliance/core/synthetic-fiscal-orchestrator";
import { FiscalAttemptState } from "../fiscal-compliance/core/fiscal-attempt-state";
import { realFiscalTestEnabled } from "../fiscal-compliance/core/test-execution";
import { restaurantBeninPreparation } from "./benin-fiscal-request-mapper";
const integer = z.number().int().safe().nonnegative();
export const realTestConfigurationSchema = z
  .object({
    orgId: z.string().min(1),
    operatorUserId: z.string().min(1),
    outletId: z.string().uuid(),
    sessionId: z.string().uuid(),
    invoiceId: z.string().uuid(),
    token: z
      .string()
      .min(1)
      .refine((v) => Boolean(v.trim()) && !/[\r\n]/.test(v)),
    ifu: z.string().min(1),
    nim: z.string().min(1),
    sourceDigest: z.string().regex(/^[a-f0-9]{64}$/),
    classifications: z.unknown(),
    mapping: z.unknown(),
    expectedFiscalTotals: z
      .object({
        ta: integer,
        tb: integer,
        tc: integer,
        td: integer,
        taa: integer,
        tab: integer,
        tac: integer,
        tad: integer,
        tae: integer,
        taf: integer,
        hab: integer,
        had: integer,
        vab: integer,
        vad: integer,
        aib: integer,
        ts: integer,
        total: integer,
      })
      .strict(),
  })
  .strict();
export type RealTestConfiguration = z.infer<typeof realTestConfigurationSchema>;
/** Real TEST provider uses the same durable orchestrator, with a separate evidence origin. */
export function restaurantBeninRealTestWorkflow(
  config: RealTestConfiguration,
  authorize: ConstructorParameters<typeof SyntheticFiscalOrchestrator>[2],
  capture = new ConfirmationCapture(process.env.FISCAL_DIAGNOSTIC_BUCKET ?? ""),
  transport: FiscalHttpTransport = nodeFetchFiscalHttpTransport,
) {
  if (!realFiscalTestEnabled()) throw new Error("FISCAL_EXECUTION_DISABLED");
  let active: FiscalAttemptState | undefined;
  const provider: MockFiscalProvider = {
    kind: "BENIN_EMECEF_TEST",
    async createInvoice(prepared: VerifiedFiscalPreparation) {
      const payload = z
        .object({
          invoice: InvoiceRequestDataDtoSchema,
          expected: z
            .object({ total: integer, itemTotals: z.array(integer) })
            .strict(),
        })
        .strict()
        .parse(prepared.payload);
      if (
        hash(canonical(clean(payload))) !== prepared.requestDigest ||
        prepared.sourceDigest !== config.sourceDigest ||
        payload.invoice.ifu !== config.ifu ||
        prepared.total !== config.expectedFiscalTotals.total ||
        prepared.ordinaryVatTotals?.net !== config.expectedFiscalTotals.hab ||
        prepared.ordinaryVatTotals?.tax !== config.expectedFiscalTotals.vab ||
        config.expectedFiscalTotals.tab !== prepared.total ||
        config.expectedFiscalTotals.tb !== 18
      )
        throw new Error("FISCAL_CONFIGURATION_MISMATCH");
      await verifyContext();
      const created = await adapter.createInvoice(
        input,
        new BeninInvoiceAttempt(),
        payload.invoice,
        payload.expected,
      );
      // Keep UID even when any detailed fiscal total differs. This is not permission to confirm.
      return {
        ...created,
        providerContextDigest: hash(
          canonical(["TEST", config.ifu, config.nim]),
        ),
        fiscalTotalsDigest: hash(canonical(config.expectedFiscalTotals)),
        reconciled:
          created.reconciled &&
          Object.entries(config.expectedFiscalTotals).every(
            ([key, value]) =>
              created[key as keyof typeof config.expectedFiscalTotals] ===
              value,
          ),
      };
    },
    async confirmInvoice(uid, state) {
      if (
        !state ||
        state.execution !== "REAL_TEST" ||
        !state.diagnostic ||
        state.sourceDigest !== config.sourceDigest ||
        state.fiscalTotalsDigest !==
          hash(canonical(config.expectedFiscalTotals)) ||
        state.providerContextDigest !==
          hash(canonical(["TEST", config.ifu, config.nim]))
      )
        throw new Error("FISCAL_REAL_RESERVATION_REQUIRED");
      active = state;
      provider.diagnostic = {
        ...state.diagnostic,
        mutationMayHaveExecuted: false,
      };
      const confirmationStarted = performance.now();
      try {
        await verifyContext();
        const result = await adapter.confirmDurableInvoice(input, state);
        if (result.nim !== config.nim) {
          provider.diagnostic = {
            ...provider.diagnostic!,
            category: "RESPONSE_VALIDATION",
          };
          throw new Error("FISCAL_SECURITY_CONTEXT_MISMATCH");
        }
        const {
          uid: _,
          errorCode: _code,
          errorDesc: _desc,
          refundWithAibPayment: _refund,
          ...security
        } = result;
        return security;
      } catch (error) {
        if (error instanceof Error && "mutationDiagnostic" in error) {
          const details = (
            error as import("../fiscal-compliance/providers/benin-emecef/benin-emecef-test-adapter").BeninEMecefConnectorError
          ).mutationDiagnostic;
          if (details && provider.diagnostic?.category !== "CAPTURE_FAILURE") {
            const {
              operation: _,
              environment: __,
              sent: ___,
              validationPaths,
              ...safe
            } = details;
            provider.diagnostic = {
              ...provider.diagnostic!,
              ...safe,
              durationMs: provider.diagnostic?.durationMs ?? safe.durationMs,
              ...(validationPaths
                ? { validationPaths: [...validationPaths] }
                : {}),
            };
          } else if (!details) {
            const failure =
              error as import("../fiscal-compliance/providers/benin-emecef/benin-emecef-test-adapter").BeninEMecefConnectorError;
            provider.diagnostic = {
              ...provider.diagnostic!,
              category:
                failure.code === "AUTHENTICATION_FAILED" ||
                failure.code === "ACCESS_FORBIDDEN"
                  ? "AUTHENTICATION"
                  : failure.code === "MALFORMED_RESPONSE"
                    ? "RESPONSE_VALIDATION"
                    : failure.httpStatus
                      ? "HTTP"
                      : "TRANSPORT",
              ...(failure.httpStatus ? { httpStatus: failure.httpStatus } : {}),
              durationMs: Math.round(performance.now() - confirmationStarted),
            };
          }
        }
        throw new Error("FISCAL_CONFIRMATION_OUTCOME_UNKNOWN");
      }
    },
    getInvoice: (uid) => adapter.getInvoice(input, uid),
  };
  let context: unknown;
  const adapter = new BeninEMecefTestAdapter({
    transport: async (request) => {
      if (request.method === "PUT" && active?.diagnostic)
        provider.diagnostic = {
          ...provider.diagnostic!,
          mutationMayHaveExecuted: true,
        };
      const started = performance.now();
      let response;
      try {
        response = await transport(request);
      } catch {
        if (request.method === "PUT" && active?.diagnostic)
          provider.diagnostic = {
            reference: active.diagnostic.reference,
            captured: false,
            mutationMayHaveExecuted: true,
            category: "TRANSPORT",
            durationMs: Math.round(performance.now() - started),
          };
        throw new Error("FISCAL_TRANSPORT_FAILED");
      }
      const durationMs = Math.round(performance.now() - started);
      if (request.url.endsWith("/api/info/status") && response.status === 200) {
        try {
          context = JSON.parse(response.body);
        } catch {
          context = undefined;
        }
      }
      if (request.method === "PUT") {
        if (!active?.diagnostic || !request.url.endsWith("/confirm"))
          throw new Error("FISCAL_CAPTURE_SCOPE_DENIED");
        try {
          await capture.save(active.diagnostic.reference, response);
          provider.diagnostic = {
            reference: active.diagnostic.reference,
            captured: true,
            mutationMayHaveExecuted: true,
            httpStatus: response.status,
            durationMs,
          };
        } catch {
          provider.diagnostic = {
            reference: active.diagnostic.reference,
            captured: false,
            mutationMayHaveExecuted: true,
            category: "CAPTURE_FAILURE",
            httpStatus: response.status,
            durationMs,
          };
          throw new Error("FISCAL_CAPTURE_FAILED");
        }
      }
      return response;
    },
  });
  const input = { environment: "TEST" as const, credential: config.token };
  async function verifyContext() {
    const status = await adapter.getStatus(input);
    const parsed = z
      .object({ ifu: z.string(), nim: z.string() })
      .safeParse(context);
    if (
      !status.serviceAvailable ||
      !parsed.success ||
      parsed.data.ifu !== config.ifu ||
      parsed.data.nim !== config.nim
    )
      throw new Error("FISCAL_PROVIDER_CONTEXT_MISMATCH");
  }
  const prepare = restaurantBeninPreparation(
    config.outletId,
    config.sessionId,
    config.classifications,
    config.mapping,
  );
  return new SyntheticFiscalOrchestrator(
    new FiscalAttemptStore(),
    provider,
    authorize,
    async (principal, identity) => {
      const result = await prepare(principal, identity);
      if (result.sourceDigest !== config.sourceDigest)
        throw new Error("FISCAL_SOURCE_MISMATCH");
      return result;
    },
    true,
  );
}
