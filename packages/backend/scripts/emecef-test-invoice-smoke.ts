import { createInterface } from "node:readline/promises";
import {
  mkdirSync,
  writeFileSync,
  openSync,
  fsyncSync,
  closeSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import {
  BeninEMecefTestAdapter,
  BeninInvoiceAttempt,
  BeninEMecefConnectorError,
} from "../lambda/domains/fiscal-compliance/providers/benin-emecef/benin-emecef-test-adapter";
import { nodeFetchFiscalHttpTransport } from "../lambda/domains/fiscal-compliance/providers/http-transport";
import { InvoiceRequestDataDtoSchema } from "../lambda/domains/fiscal-compliance/providers/benin-emecef/invoice-dtos";

// Operator-only harness. No retries, automatic confirmation or cancellation.
async function main() {
  let credential = process.env.EMECEF_TEST_TOKEN;
  delete process.env.EMECEF_TEST_TOKEN;
  if (!process.stdin.isTTY || !credential?.trim())
    throw Error("TOKEN_OR_TERMINAL_REQUIRED");
  const terminal = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const ask = async (prompt: string) =>
    (await terminal.question(prompt)).trim();
  let directory: string | undefined;
  let phase = "PREFLIGHT";
  let uid: string | undefined;
  let postSent = false,
    confirmSent = false;
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
    let context: unknown;
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
            request.url !==
              `https://developper.impots.bj/sygmef-emcf/api/invoice/${encodeURIComponent(uid!)}/confirm`
          )
            throw Error("MUTATION_BLOCKED");
          confirmSent = true;
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
    const groups = await adapter.getTaxGroups(input);
    const types = await adapter.getInvoiceTypes(input);
    const payments = await adapter.getPaymentTypes(input);
    if (
      !types.some((t) => t.type === "FV") ||
      !payments.some((p) => p.type === "ESPECES") ||
      groups.b !== 18
    )
      throw Error("REQUIRED_METADATA_MISSING");
    console.log(
      JSON.stringify(
        {
          contextMatched: true,
          taxGroups: groups,
          invoiceTypes: types.map((t) => t.type),
          paymentTypes: payments.map((p) => p.type),
        },
        null,
        2,
      ),
    );
    console.log(
      "TEST HYPOTHESIS: the official e-SFE guide documents TTC unit prices and group B at 18%; current OpenAPI does not explicitly prove that API price semantics are TTC.",
    );
    const taxGroup = "B" as const;
    const invoice = InvoiceRequestDataDtoSchema.parse({
      ifu: ctx.ifu,
      type: "FV",
      operator: { name: "LIASS TEST" },
      items: [
        {
          name: "Article test LIASS-RESTO",
          price: 1000,
          quantity: 2,
          taxGroup,
        },
      ],
      payment: [{ name: "ESPECES", amount: 2000 }],
    });
    const expected = { itemTotals: [2000], total: 2000 };
    console.log(
      JSON.stringify(
        {
          environment: "TEST",
          type: "FV",
          product: "Article test LIASS-RESTO",
          quantity: 2,
          unitPrice: 1000,
          priceBasis: "TTC_TEST_HYPOTHESIS",
          taxGroup,
          taxGroupSelection:
            "EXPLICIT_DEMONSTRATION_CLASSIFICATION; NOT INFERRED FROM A ZERO RATE",
          payment: "ESPECES",
          expectedTotal: 2000,
          expectedTotalBasis:
            "1000 TTC hypothesis × 2; confirmation blocked if DGI returns another total",
        },
        null,
        2,
      ),
    );
    if (
      (await ask(
        "Authorize CREATE of this one TEST invoice? Type CREATE: ",
      )) !== "CREATE"
    )
      return;
    directory = join(homedir(), `.liass-emecef-smoke-${randomUUID()}`);
    mkdirSync(directory, { mode: 0o700 });
    phase = "CREATE_AUTHORIZED";
    save({
      outcome: "BEFORE_SINGLE_POST",
      expectedTotal: 2000,
      taxGroup,
      priceBasis: "TTC_TEST_HYPOTHESIS",
      conventionReference:
        "https://api.impots.bj/media/62b9cd08db7f0_MANUEL%20DE%20FACTURATION%20E-MECEF.pdf",
    });
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
    });
    if (!created.reconciled) throw Error("TOTAL_MISMATCH");
    console.log(
      JSON.stringify({
        uid,
        total: created.total,
        reconciled: true,
        privateEvidenceDirectory: directory,
      }),
    );
    // Adapter re-reads and compares the complete invoice before its single PUT.
    const details = await adapter.getInvoice(input, uid);
    const {
      errorCode: _code,
      errorDesc: _description,
      paymentUrl: _url,
      ...remoteInvoice
    } = details;
    if (!isDeepStrictEqual(remoteInvoice, invoice))
      throw Error("INVOICE_DETAILS_MISMATCH");
    if (
      (await ask("Authorize CONFIRM of this TEST invoice? Type CONFIRM: ")) !==
      "CONFIRM"
    )
      return;
    phase = "CONFIRM_AUTHORIZED";
    save({ outcome: "BEFORE_SINGLE_CONFIRM" });
    const confirmed = await adapter.confirmInvoice(
      input,
      uid,
      invoice,
      expected,
      created,
    );
    if (confirmed.nim !== ctx.nim) {
      save({ outcome: "SECURITY_CONTEXT_MISMATCH" });
      throw Error("SECURITY_CONTEXT_MISMATCH");
    }
    save({ outcome: "CONFIRMED", total: created.total, ...confirmed });
    console.log(
      JSON.stringify(
        {
          environment: "TEST",
          uid,
          total: created.total,
          reconciled: true,
          confirmation: "PASS",
          qrCode: "PRESENT",
          codeMECeFDGI: "PRESENT",
          dateTime: confirmed.dateTime,
          counters: confirmed.counters,
          nimMatched: true,
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
        outcome:
          postSent || confirmSent
            ? "STOPPED_RECONCILE_BEFORE_ANY_FURTHER_MUTATION"
            : "STOPPED",
        code,
      });
    console.error(
      JSON.stringify({
        environment: "TEST",
        phase,
        code,
        uid,
        privateEvidenceDirectory: directory,
        mutationRetry: false,
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
  console.error("Preflight stopped; no automatic retry.");
  process.exitCode = 1;
});
