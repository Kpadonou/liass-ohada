import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline/promises";
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import {
  BeninEMecefConnectorError,
  BeninEMecefTestAdapter,
  BeninExpectedFiscalTotals,
  BeninInvoiceAttempt,
} from "../lambda/domains/fiscal-compliance/providers/benin-emecef/benin-emecef-test-adapter";
import { InvoiceRequestDataDtoSchema } from "../lambda/domains/fiscal-compliance/providers/benin-emecef/invoice-dtos";
import { nodeFetchFiscalHttpTransport } from "../lambda/domains/fiscal-compliance/providers/http-transport";

const expectedFiscalTotals: BeninExpectedFiscalTotals = {
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
};

async function main() {
  let credential = process.env.EMECEF_TEST_TOKEN;
  delete process.env.EMECEF_TEST_TOKEN;
  if (!process.stdin.isTTY || !credential?.trim())
    throw Error("TOKEN_OR_TERMINAL_REQUIRED");
  const terminal = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  let directory: string | undefined;
  let uid: string | undefined;
  let phase = "PREFLIGHT";
  let postSent = false;
  let confirmSent = false;
  let context: unknown;
  const save = (data: object) => {
    if (!directory) throw Error("PRIVATE_STORAGE_UNAVAILABLE");
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
        if (request.method === "POST") {
          if (
            phase !== "CREATE_AUTHORIZED" ||
            postSent ||
            url.pathname !== "/sygmef-emcf/api/invoice"
          )
            throw Error("MUTATION_BLOCKED");
          postSent = true;
        } else if (request.method === "PUT") {
          if (
            phase !== "CONFIRM_AUTHORIZED" ||
            confirmSent ||
            request.body !== undefined ||
            request.url !==
              `https://developper.impots.bj/sygmef-emcf/api/invoice/${encodeURIComponent(uid!)}/confirm`
          )
            throw Error("MUTATION_BLOCKED");
          confirmSent = true;
        } else if (request.method !== "GET" || phase !== "PREFLIGHT") {
          throw Error("MUTATION_BLOCKED");
        }
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
    const [groups, types, payments] = await Promise.all([
      adapter.getTaxGroups(input),
      adapter.getInvoiceTypes(input),
      adapter.getPaymentTypes(input),
    ]);
    if (
      groups.b !== 18 ||
      !types.some((entry) => entry.type === "FV") ||
      !payments.some((entry) => entry.type === "ESPECES")
    )
      throw Error("REQUIRED_METADATA_MISSING");

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
    console.log(
      JSON.stringify(
        {
          environment: "TEST",
          contextVerified: true,
          type: "FV",
          product: "Article test LIASS-RESTO",
          quantity: 2,
          unitPriceTtcHypothesis: 1000,
          taxGroup: "B",
          taxRate: 18,
          payment: "ESPECES",
          expectedTotal: 2000,
          expectedFiscalTotals,
          sequence: "ONE_POST_THEN_CONDITIONAL_ONE_PUT_WITHOUT_GET",
        },
        null,
        2,
      ),
    );
    const createApproval = (
      await terminal.question(
        "Authorize CREATE of one fresh TEST invoice? Type CREATE: ",
      )
    ).trim();
    const confirmApproval = (
      await terminal.question(
        "Pre-authorize immediate CONFIRM only if CREATE and every fiscal total match? Type CONFIRM: ",
      )
    ).trim();
    if (createApproval !== "CREATE" || confirmApproval !== "CONFIRM") return;

    directory = join(homedir(), `.liass-emecef-timed-smoke-${randomUUID()}`);
    mkdirSync(directory, { mode: 0o700 });
    phase = "CREATE_AUTHORIZED";
    save({
      outcome: "BEFORE_TIMED_SEQUENCE",
      createAuthorized: true,
      conditionalConfirmAuthorized: true,
      expectedTotal: 2000,
      expectedFiscalTotals,
      taxGroup: "B",
      priceBasis: "TTC_TEST_HYPOTHESIS",
    });
    const sequenceStartedAt = Date.now();
    const created = await adapter.createInvoice(
      input,
      new BeninInvoiceAttempt(),
      invoice,
      expected,
    );
    uid = created.uid;
    save({
      outcome: "CREATED",
      total: created.total,
      reconciled: created.reconciled,
      fiscalTotals: Object.fromEntries(
        Object.keys(expectedFiscalTotals).map((key) => [
          key,
          created[key as keyof typeof expectedFiscalTotals],
        ]),
      ),
    });
    if (
      !created.reconciled ||
      Object.entries(expectedFiscalTotals).some(
        ([field, value]) =>
          created[field as keyof typeof expectedFiscalTotals] !== value,
      )
    )
      throw Error("CREATE_FISCAL_TOTALS_MISMATCH");
    phase = "CONFIRM_AUTHORIZED";
    save({ outcome: "BEFORE_SINGLE_CONFIRM", uidKnown: true });
    const confirmed = await adapter.confirmCreatedInvoice(
      input,
      uid,
      invoice,
      expected,
      created,
      expectedFiscalTotals,
    );
    if (confirmed.nim !== ctx.nim) {
      save({ outcome: "SECURITY_CONTEXT_MISMATCH" });
      throw Error("SECURITY_CONTEXT_MISMATCH");
    }
    save({
      outcome: "CONFIRMED",
      total: created.total,
      postToConfirmElapsedMs: Date.now() - sequenceStartedAt,
      ...confirmed,
    });
    console.log(
      JSON.stringify(
        {
          environment: "TEST",
          confirmation: "PASS",
          total: created.total,
          fiscalTotalsMatched: true,
          qrCode: "PRESENT",
          codeMECeFDGI: "PRESENT",
          dateTime: confirmed.dateTime,
          counters: confirmed.counters,
          nimMatched: true,
          postToConfirmElapsedMs: Date.now() - sequenceStartedAt,
          privateEvidenceDirectory: directory,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    const code =
      error instanceof BeninEMecefConnectorError ? error.code : "STOPPED";
    if (directory)
      save({
        outcome: confirmSent
          ? "CONFIRM_OUTCOME_UNKNOWN_NO_RETRY"
          : postSent
            ? uid
              ? "CREATED_NOT_CONFIRMED_NO_REPLACEMENT"
              : "CREATE_OUTCOME_UNKNOWN_NO_RETRY"
            : "STOPPED_BEFORE_MUTATION",
        code,
        ...(error instanceof BeninEMecefConnectorError &&
        error.providerDiagnostic
          ? error.providerDiagnostic
          : {}),
      });
    console.error(
      JSON.stringify({
        environment: "TEST",
        phase,
        code,
        postSent,
        confirmSent,
        mutationRetry: false,
        automaticReplacement: false,
        privateEvidenceDirectory: directory,
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
  console.error("Timed TEST smoke stopped; no automatic mutation retry.");
  process.exitCode = 1;
});
