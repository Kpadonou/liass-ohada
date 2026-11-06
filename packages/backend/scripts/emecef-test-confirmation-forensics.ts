import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join } from "node:path";
import { z } from "zod";
import { BENIN_EMECEF_TEST_BASE_URL } from "../lambda/domains/fiscal-compliance/providers/benin-emecef/benin-emecef-test-adapter";
import {
  InvoiceDetailsDtoSchema,
  InvoiceRequestDataDtoSchema,
} from "../lambda/domains/fiscal-compliance/providers/benin-emecef/invoice-dtos";
import { nodeFetchFiscalHttpTransport } from "../lambda/domains/fiscal-compliance/providers/http-transport";

const expectedFiscalTotals = {
  ta: 0,
  tb: 18,
  tc: 0,
  td: 18,
  taa: 0,
  tab: 2000,
  tac: 0,
  tad: 0,
  tae: 0,
  taf: 0,
  hab: 1695,
  had: 0,
  vab: 305,
  vad: 0,
  aib: 0,
  ts: 0,
  total: 2000,
} as const;

const checkpointSchema = z
  .object({
    environment: z.literal("TEST"),
    phase: z.string(),
    outcome: z.string(),
    uid: z.string().min(1).max(500).optional(),
    total: z.number().int().safe().optional(),
    reconciled: z.boolean().optional(),
    fiscalTotals: z.record(z.string(), z.number()).optional(),
  })
  .passthrough();

function evidenceDirectory() {
  const flag = process.argv.indexOf("--evidence-dir");
  const supplied = flag >= 0 ? process.argv[flag + 1] : undefined;
  if (!supplied || !isAbsolute(supplied))
    throw Error("EVIDENCE_DIRECTORY_REQUIRED");
  const resolved = realpathSync(supplied);
  const info = lstatSync(resolved);
  if (
    !info.isDirectory() ||
    info.isSymbolicLink() ||
    info.uid !== process.getuid?.() ||
    (info.mode & 0o777) !== 0o700 ||
    realpathSync(dirname(resolved)) !== realpathSync(homedir()) ||
    !basename(resolved).startsWith(".liass-emecef-timed-smoke-")
  )
    throw Error("UNSAFE_EVIDENCE_DIRECTORY");
  return resolved;
}

function safeProviderCode(value: unknown) {
  return typeof value === "string" && /^[A-Za-z0-9._-]{1,64}$/.test(value)
    ? value
    : "UNRECOGNIZED_FORMAT";
}

function actualType(value: unknown) {
  if (value === undefined) return "missing";
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

async function main() {
  let credential = process.env.EMECEF_TEST_TOKEN;
  delete process.env.EMECEF_TEST_TOKEN;
  if (!credential?.trim()) throw Error("TOKEN_REQUIRED");
  try {
    const directory = evidenceDirectory();
    const records = readdirSync(directory)
      .filter((name) => name.endsWith(".json"))
      .sort()
      .map((name) => {
        const path = join(directory, name);
        const info = lstatSync(path);
        if (
          !info.isFile() ||
          info.isSymbolicLink() ||
          info.uid !== process.getuid?.() ||
          (info.mode & 0o777) !== 0o600
        )
          throw Error("UNSAFE_EVIDENCE_FILE");
        return checkpointSchema.parse(JSON.parse(readFileSync(path, "utf8")));
      });
    const created = records.filter((record) => record.outcome === "CREATED");
    const unknown = records.some(
      (record) => record.outcome === "CONFIRM_OUTCOME_UNKNOWN_NO_RETRY",
    );
    const intent = records.some(
      (record) => record.outcome === "BEFORE_SINGLE_CONFIRM",
    );
    if (
      created.length !== 1 ||
      !created[0].uid ||
      created[0].total !== 2000 ||
      created[0].reconciled !== true ||
      JSON.stringify(created[0].fiscalTotals) !==
        JSON.stringify(expectedFiscalTotals) ||
      !intent ||
      !unknown
    )
      throw Error("FORENSIC_CHECKPOINTS_INVALID");
    const uid = created[0].uid;
    const uidHandle = createHash("sha256")
      .update(uid)
      .digest("hex")
      .slice(0, 12);

    const get = async (path: string) => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);
      try {
        return await nodeFetchFiscalHttpTransport({
          method: "GET",
          url: `${BENIN_EMECEF_TEST_BASE_URL}${path}`,
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${credential}`,
          },
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }
    };
    const decode = (body: string) => {
      if (Buffer.byteLength(body, "utf8") > 64 * 1024)
        throw Error("RESPONSE_TOO_LARGE");
      return JSON.parse(body) as unknown;
    };

    const infoResponse = await get("/api/info/status");
    if (infoResponse.status !== 200)
      throw Error(`INFO_HTTP_${infoResponse.status}`);
    const info = z
      .object({
        status: z.boolean(),
        ifu: z.string().min(1),
        nim: z.string().min(1),
        emcfList: z.array(
          z.object({ nim: z.string().nullable().optional() }).passthrough(),
        ),
      })
      .passthrough()
      .parse(decode(infoResponse.body));
    if (
      !info.status ||
      !info.emcfList.some((device) => device.nim === info.nim)
    )
      throw Error("TEST_CONTEXT_NOT_VERIFIED");

    const pendingResponse = await get("/api/invoice");
    let pendingListEvidence: "PRESENT" | "ABSENT" | "UNAVAILABLE" =
      "UNAVAILABLE";
    if (pendingResponse.status === 200) {
      const pending = z
        .object({
          pendingRequestsList: z
            .array(
              z.object({ uid: z.string().nullable().optional() }).passthrough(),
            )
            .nullable()
            .optional(),
        })
        .passthrough()
        .safeParse(decode(pendingResponse.body));
      if (pending.success)
        pendingListEvidence = pending.data.pendingRequestsList?.some(
          (entry) => entry.uid === uid,
        )
          ? "PRESENT"
          : "ABSENT";
    }

    const detailsResponse = await get(
      `/api/invoice/${encodeURIComponent(uid)}`,
    );
    const result: Record<string, unknown> = {
      environment: "TEST",
      uidHandle,
      mode: "READ_ONLY_FORENSICS",
      contextVerified: true,
      pendingListEvidence,
      detailsHttpStatus: detailsResponse.status,
      limitation:
        "Absence from pending requests or provider error 20 cannot distinguish confirmed, cancelled, expired, or missing. Security elements cannot be recovered by these GET endpoints.",
    };
    if (detailsResponse.status !== 200) {
      result.classification = "HTTP_REJECTION";
    } else {
      const decoded = decode(detailsResponse.body);
      const providerError = z
        .object({ errorCode: z.unknown().optional() })
        .passthrough()
        .safeParse(decoded);
      if (providerError.success && providerError.data.errorCode) {
        result.classification = "PROVIDER_REJECTION";
        result.providerErrorCode = safeProviderCode(
          providerError.data.errorCode,
        );
      } else {
        const detailsSchema = InvoiceDetailsDtoSchema.extend({
          type: z.enum(["FV", "FA", "EV", "EA", "NA"]).optional(),
        });
        const details = detailsSchema.safeParse(decoded);
        if (!details.success) {
          result.classification = "SCHEMA_MISMATCH";
          result.validationIssues = details.error.issues
            .slice(0, 20)
            .map((issue) => {
              let actual: unknown = decoded;
              for (const segment of issue.path) {
                if (!actual || typeof actual !== "object") {
                  actual = undefined;
                  break;
                }
                actual = (actual as Record<PropertyKey, unknown>)[segment];
              }
              return {
                path: issue.path.length
                  ? issue.path.map(String).join(".")
                  : "$",
                expected:
                  "expected" in issue && typeof issue.expected === "string"
                    ? issue.expected
                    : issue.code,
                actual: actualType(actual),
              };
            });
        } else {
          const expectedInvoice = InvoiceRequestDataDtoSchema.parse({
            ifu: info.ifu,
            type: "FV",
            operator: { name: "LIASS TEST" },
            items: [
              {
                name: "Article test LIASS-RESTO",
                price: 1000,
                quantity: 2,
                taxGroup: "B",
              },
            ],
            payment: [{ name: "ESPECES", amount: 2000 }],
          });
          const actual = structuredClone(details.data) as Record<
            string,
            unknown
          >;
          const expected = structuredClone(expectedInvoice) as Record<
            string,
            unknown
          >;
          delete actual.errorCode;
          delete actual.errorDesc;
          delete actual.paymentUrl;
          const typeEvidence = actual.type;
          delete actual.type;
          delete expected.type;
          if (actual.operator === undefined) delete expected.operator;
          result.classification = "PENDING_DETAILS_AVAILABLE";
          result.commercialEvidenceMatched =
            JSON.stringify(actual) === JSON.stringify(expected);
          result.invoiceTypeEvidence = typeEvidence;
          result.operatorEvidence = details.data.operator
            ? "PRESENT"
            : "ABSENT";
        }
      }
    }
    console.log(JSON.stringify(result, null, 2));
  } finally {
    credential = undefined;
    delete process.env.EMECEF_TEST_TOKEN;
  }
}

main().catch((error: unknown) => {
  delete process.env.EMECEF_TEST_TOKEN;
  console.error(
    JSON.stringify({
      environment: "TEST",
      mode: "READ_ONLY_FORENSICS",
      classification: "LOCAL_OR_TRANSPORT_FAILURE",
      code: error instanceof Error ? error.message : "STOPPED",
      mutationExecuted: false,
    }),
  );
  process.exitCode = 1;
});
