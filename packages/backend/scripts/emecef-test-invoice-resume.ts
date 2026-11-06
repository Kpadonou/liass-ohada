import { createHash, randomUUID } from "node:crypto";
import { createInterface } from "node:readline/promises";
import {
  closeSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join } from "node:path";
import { z } from "zod";
import {
  BeninEMecefConnectorError,
  BeninEMecefTestAdapter,
} from "../lambda/domains/fiscal-compliance/providers/benin-emecef/benin-emecef-test-adapter";
import { nodeFetchFiscalHttpTransport } from "../lambda/domains/fiscal-compliance/providers/http-transport";
import { InvoiceRequestDataDtoSchema } from "../lambda/domains/fiscal-compliance/providers/benin-emecef/invoice-dtos";

const id = z.string().min(1).max(500);
const checkpointSchema = z
  .object({
    environment: z.literal("TEST"),
    phase: z.string(),
    outcome: z.string(),
    uid: id.optional(),
    total: z.number().int().safe().optional(),
    reconciled: z.boolean().optional(),
    expectedTotal: z.number().int().safe().optional(),
    taxGroup: z.string().optional(),
    priceBasis: z.string().optional(),
    dateTime: id.optional(),
    qrCode: id.optional(),
    codeMECeFDGI: id.optional(),
    counters: id.optional(),
    nim: id.optional(),
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
    !basename(resolved).startsWith(".liass-emecef-smoke-")
  )
    throw Error("UNSAFE_EVIDENCE_DIRECTORY");
  return resolved;
}

async function main() {
  const reconcileOnly = process.argv.includes("--reconcile-only");
  let credential = process.env.EMECEF_TEST_TOKEN;
  delete process.env.EMECEF_TEST_TOKEN;
  if (!process.stdin.isTTY || !credential?.trim())
    throw Error("TOKEN_OR_TERMINAL_REQUIRED");
  const directory = evidenceDirectory();
  const records = readdirSync(directory)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => {
      const path = join(directory, name),
        info = lstatSync(path);
      if (
        !info.isFile() ||
        info.isSymbolicLink() ||
        info.uid !== process.getuid?.() ||
        (info.mode & 0o777) !== 0o600
      )
        throw Error("UNSAFE_EVIDENCE_FILE");
      return checkpointSchema.parse(JSON.parse(readFileSync(path, "utf8")));
    });
  const created = records.filter((r) => r.outcome === "CREATED");
  if (
    created.length !== 1 ||
    !created[0].uid ||
    created[0].total !== 2000 ||
    created[0].reconciled !== true
  )
    throw Error("CREATED_CHECKPOINT_INVALID");
  const uid = created[0].uid;
  if (records.some((r) => r.uid && r.uid !== uid))
    throw Error("CHECKPOINT_UID_CONFLICT");
  const prior = records.find((r) => r.outcome === "BEFORE_SINGLE_POST");
  if (
    prior?.expectedTotal !== 2000 ||
    prior.taxGroup !== "B" ||
    prior.priceBasis !== "TTC_TEST_HYPOTHESIS"
  )
    throw Error("CREATE_INTENT_CHECKPOINT_INVALID");
  const alreadyConfirmed = records.find((r) => r.outcome === "CONFIRMED");
  const priorConfirmIntent = records.some((r) =>
    [
      "BEFORE_SINGLE_CONFIRM_RESUME",
      "CONFIRM_OUTCOME_UNKNOWN_NO_RETRY",
    ].includes(r.outcome),
  );
  const uidHandle = createHash("sha256").update(uid).digest("hex").slice(0, 12);
  if (alreadyConfirmed) {
    if (
      !alreadyConfirmed.qrCode ||
      !alreadyConfirmed.codeMECeFDGI ||
      !alreadyConfirmed.dateTime ||
      !alreadyConfirmed.counters ||
      !alreadyConfirmed.nim
    )
      throw Error("CONFIRMED_CHECKPOINT_INCOMPLETE");
    console.log(
      JSON.stringify(
        {
          environment: "TEST",
          uidHandle,
          confirmation: "ALREADY_CONFIRMED",
          total: alreadyConfirmed.total,
          qrCode: "PRESENT",
          codeMECeFDGI: "PRESENT",
          dateTime: alreadyConfirmed.dateTime,
          counters: alreadyConfirmed.counters,
          nim: "PRESENT",
          mutationExecuted: false,
        },
        null,
        2,
      ),
    );
    return;
  }
  if (priorConfirmIntent)
    throw Error("CONFIRM_INTENT_ALREADY_RECORDED_NO_RETRY");

  const terminal = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  let phase = "RECONCILE",
    putSent = false,
    context: unknown;
  const save = (data: object) => {
    const path = join(directory, `${Date.now()}-${randomUUID()}.json`);
    writeFileSync(
      path,
      JSON.stringify({ environment: "TEST", phase, uid, ...data }, null, 2),
      { mode: 0o600, flag: "wx" },
    );
    const fd = openSync(path, "r");
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  };
  try {
    const adapter = new BeninEMecefTestAdapter({
      transport: async (request) => {
        const url = new URL(request.url);
        if (
          url.origin !== "https://developper.impots.bj" ||
          !url.pathname.startsWith("/sygmef-emcf/api/")
        )
          throw Error("TEST_ONLY");
        if (request.method === "POST") throw Error("CREATE_FORBIDDEN");
        if (request.method === "PUT") {
          if (
            reconcileOnly ||
            phase !== "CONFIRM_AUTHORIZED" ||
            putSent ||
            request.url !==
              `https://developper.impots.bj/sygmef-emcf/api/invoice/${encodeURIComponent(uid)}/confirm`
          )
            throw Error("MUTATION_BLOCKED");
          putSent = true;
        } else if (request.method !== "GET") throw Error("MUTATION_BLOCKED");
        const response = await nodeFetchFiscalHttpTransport(request);
        if (request.url.endsWith("/api/info/status") && response.status === 200)
          context = JSON.parse(response.body);
        return response;
      },
    });
    const input = { environment: "TEST" as const, credential };
    const status = await adapter.getStatus(input);
    const ctx = z
      .object({
        ifu: z.string().min(1),
        nim: z.string().min(1),
        emcfList: z.array(
          z.object({ nim: z.string().nullable().optional() }).passthrough(),
        ),
      })
      .passthrough()
      .parse(context);
    if (
      !status.serviceAvailable ||
      !ctx.emcfList.some((d) => d.nim === ctx.nim)
    )
      throw Error("TEST_CONTEXT_NOT_VERIFIED");
    const invoice = InvoiceRequestDataDtoSchema.parse({
      ifu: ctx.ifu,
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
    const expected = { itemTotals: [2000], total: 2000 };
    const capability = await adapter.prepareExistingInvoiceConfirmation(
      input,
      uid,
      invoice,
      expected,
      { uid, total: 2000, reconciled: true },
    );
    console.log(
      JSON.stringify(
        {
          environment: "TEST",
          uidHandle,
          existingInvoice: "MATCH",
          type: capability.invoiceType,
          submittedType: "FV",
          typeEvidence:
            capability.invoiceType === "NA"
              ? "TEST_ONLY_NA_DISCREPANCY_ACCEPTED"
              : "MATCH",
          operatorEvidence: capability.operatorEvidence,
          product: "Article test LIASS-RESTO",
          quantity: 2,
          unitPrice: 1000,
          priceBasis: "TTC_TEST_HYPOTHESIS",
          taxGroup: "B",
          payment: "ESPECES",
          providerTotal: 2000,
          reconciled: true,
        },
        null,
        2,
      ),
    );
    if (reconcileOnly) {
      save({ outcome: "RECONCILED_READ_ONLY", uidHandle, total: 2000 });
      console.log(
        JSON.stringify(
          {
            environment: "TEST",
            uidHandle,
            reconciliation: "PASS",
            mode: "READ_ONLY",
            mutationExecuted: false,
            confirmationEligible: true,
            nextAction: "SEPARATE_CONFIRMATION_AUTHORIZATION_REQUIRED",
          },
          null,
          2,
        ),
      );
      return;
    }
    const answer = (
      await terminal.question(
        "Authorize CONFIRM of this existing TEST invoice? Type CONFIRM: ",
      )
    ).trim();
    if (answer !== "CONFIRM") return;
    phase = "CONFIRM_AUTHORIZED";
    save({ outcome: "BEFORE_SINGLE_CONFIRM_RESUME", uidHandle });
    const confirmed = await adapter.confirmPreparedInvoice(input, capability);
    if (confirmed.nim !== ctx.nim) {
      save({ outcome: "SECURITY_CONTEXT_MISMATCH" });
      throw Error("SECURITY_CONTEXT_MISMATCH");
    }
    save({ outcome: "CONFIRMED", total: 2000, ...confirmed });
    console.log(
      JSON.stringify(
        {
          environment: "TEST",
          uidHandle,
          total: 2000,
          reconciled: true,
          confirmation: "PASS",
          qrCode: "PRESENT",
          codeMECeFDGI: "PRESENT",
          dateTime: confirmed.dateTime,
          counters: confirmed.counters,
          nimMatched: true,
          evidenceDirectory: directory,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    const code =
      error instanceof BeninEMecefConnectorError ? error.code : "STOPPED";
    save({
      outcome: putSent
        ? "CONFIRM_OUTCOME_UNKNOWN_NO_RETRY"
        : "RESUME_STOPPED_BEFORE_MUTATION",
      code,
      uidHandle,
      ...(error instanceof BeninEMecefConnectorError && error.validationIssues
        ? { validationIssues: error.validationIssues }
        : {}),
      ...(error instanceof BeninEMecefConnectorError && error.providerDiagnostic
        ? error.providerDiagnostic
        : {}),
    });
    console.error(
      JSON.stringify({
        environment: "TEST",
        phase,
        uidHandle,
        code,
        putSent,
        mutationRetry: false,
        ...(error instanceof BeninEMecefConnectorError && error.validationIssues
          ? { validationIssues: error.validationIssues }
          : {}),
        ...(error instanceof BeninEMecefConnectorError &&
        error.providerDiagnostic
          ? error.providerDiagnostic
          : {}),
        evidenceDirectory: directory,
      }),
    );
    process.exitCode = 1;
  } finally {
    credential = undefined;
    delete process.env.EMECEF_TEST_TOKEN;
    terminal.close();
  }
}
main().catch(() => {
  delete process.env.EMECEF_TEST_TOKEN;
  console.error("Resume stopped; no mutation retry.");
  process.exitCode = 1;
});
