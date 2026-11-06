import { emitKeypressEvents } from "node:readline";
import { z } from "zod";
import {
  BeninEMecefConnectorError,
  BeninEMecefTestAdapter,
} from "@/lambda/domains/fiscal-compliance/providers/benin-emecef/benin-emecef-test-adapter";
import {
  FiscalHttpTransport,
  nodeFetchFiscalHttpTransport,
} from "@/lambda/domains/fiscal-compliance/providers/http-transport";

const statusContextSchema = z
  .object({
    ifu: z.string().min(1).nullable().optional(),
    nim: z.string().min(1).nullable().optional(),
    emcfList: z
      .array(
        z
          .object({
            nim: z.string().min(1).nullable().optional(),
            status: z.string().min(1).nullable().optional(),
          })
          .passthrough(),
      )
      .nullable()
      .optional(),
  })
  .passthrough();

function readSecret(prompt: string): Promise<string> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("INTERACTIVE_TERMINAL_REQUIRED");
  }
  process.stdout.write(prompt);
  emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdin.resume();

  return new Promise((resolve, reject) => {
    let secret = "";
    const finish = (error?: Error) => {
      process.stdin.off("keypress", onKeypress);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write("\n");
      if (error) reject(error);
      else resolve(secret);
    };
    const onKeypress = (
      value: string,
      key: { name?: string; ctrl?: boolean },
    ) => {
      if (key.ctrl && key.name === "c") return finish(new Error("CANCELLED"));
      if (key.name === "return" || key.name === "enter") return finish();
      if (key.name === "backspace") secret = secret.slice(0, -1);
      else if (!key.ctrl && value) secret += value;
    };
    process.stdin.on("keypress", onKeypress);
  });
}

function safeError(error: unknown) {
  if (error instanceof BeninEMecefConnectorError) {
    return { code: error.code, httpStatus: error.httpStatus ?? null };
  }
  if (
    error instanceof Error &&
    ["CANCELLED", "INTERACTIVE_TERMINAL_REQUIRED"].includes(error.message)
  ) {
    return { code: error.message, httpStatus: null };
  }
  return { code: "PREFLIGHT_FAILED", httpStatus: null };
}

async function main() {
  let credential = await readSecret("e-MECeF TEST token (input hidden): ");
  if (!credential.trim() || /[\r\n]/.test(credential)) {
    credential = "";
    throw new Error("INVALID_CREDENTIAL_INPUT");
  }

  // The environment entry exists only for this process and is always removed below.
  process.env.EMECEF_TEST_TOKEN = credential;
  let rawStatusBody: string | undefined;
  const observingTransport: FiscalHttpTransport = async (request) => {
    if (request.method !== "GET") throw new Error("READ_ONLY_PREFLIGHT");
    const response = await nodeFetchFiscalHttpTransport(request);
    if (request.url.endsWith("/api/info/status") && response.status === 200) {
      rawStatusBody = response.body;
    }
    return response;
  };

  try {
    const adapter = new BeninEMecefTestAdapter({
      transport: observingTransport,
    });
    const input = { environment: "TEST" as const, credential };
    const status = await adapter.getStatus(input);
    const [taxGroups, invoiceTypes, paymentTypes] = await Promise.all([
      adapter.getTaxGroups(input),
      adapter.getInvoiceTypes(input),
      adapter.getPaymentTypes(input),
    ]);

    const context = statusContextSchema.parse(
      JSON.parse(rawStatusBody ?? "null"),
    );
    const devices = context.emcfList ?? [];
    const matchingDevice = Boolean(
      context.nim && devices.some((device) => device.nim === context.nim),
    );
    const activeDeviceCount = devices.filter(
      (device) => device.status?.toUpperCase() === "ACTIF",
    ).length;
    const authorizedContextVerified = Boolean(
      context.ifu && context.nim && devices.length > 0 && matchingDevice,
    );

    const missingPrerequisites = [
      ...(!context.ifu ? ["AUTHORIZED_TEST_IFU_NOT_RETURNED"] : []),
      ...(!context.nim ? ["AUTHORIZED_TEST_NIM_NOT_RETURNED"] : []),
      ...(devices.length === 0 ? ["NO_CONFIGURED_TEST_DEVICE"] : []),
      ...(context.nim && devices.length > 0 && !matchingDevice
        ? ["STATUS_NIM_NOT_IN_CONFIGURED_DEVICE_LIST"]
        : []),
      "CURRENT_PRICE_BASIS_NOT_ESTABLISHED_BY_METADATA",
      "TAX_APPLICABILITY_REQUIRES_EXPLICIT_BUSINESS_EVIDENCE",
    ];

    console.log(
      JSON.stringify(
        {
          environment: "TEST",
          readOnly: true,
          connectivity: "PASS",
          authentication: "PASS",
          serviceAvailable: status.serviceAvailable,
          apiVersion: status.apiVersion,
          tokenValidUntil: status.tokenValidUntil,
          serverDateTime: status.serverDateTime,
          authorizedContext: {
            verified: authorizedContextVerified,
            ifuPresent: Boolean(context.ifu),
            nimPresent: Boolean(context.nim),
            configuredDeviceCount: devices.length,
            matchingDevice,
            activeDeviceCount,
          },
          metadata: {
            taxGroups,
            invoiceTypes,
            paymentTypes,
          },
          conventions: {
            taxTreatmentInferred: false,
            priceBasisEstablished: false,
          },
          missingPrerequisites,
        },
        null,
        2,
      ),
    );
  } finally {
    delete process.env.EMECEF_TEST_TOKEN;
    credential = "";
    rawStatusBody = undefined;
  }
}

main().catch((error) => {
  delete process.env.EMECEF_TEST_TOKEN;
  console.error(
    JSON.stringify({
      environment: "TEST",
      readOnly: true,
      ...safeError(error),
    }),
  );
  process.exitCode = 1;
});
