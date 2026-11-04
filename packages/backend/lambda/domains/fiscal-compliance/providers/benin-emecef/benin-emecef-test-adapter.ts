import { Buffer } from "node:buffer";
import { z } from "zod";
import {
  FiscalHttpTransport,
  nodeFetchFiscalHttpTransport,
} from "../http-transport";

export const BENIN_EMECEF_TEST_BASE_URL =
  "https://developper.impots.bj/sygmef-emcf";
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
  | "MISSING_CREDENTIAL"
  | "ENVIRONMENT_NOT_ALLOWED"
  | "AUTHENTICATION_FAILED"
  | "ACCESS_FORBIDDEN"
  | "TIMEOUT"
  | "NETWORK_FAILURE"
  | "MALFORMED_RESPONSE"
  | "UNEXPECTED_HTTP_STATUS";

const safeMessages: Record<BeninEMecefConnectorErrorCode, string> = {
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
    if (input.environment !== "TEST") {
      throw new BeninEMecefConnectorError("ENVIRONMENT_NOT_ALLOWED");
    }
    if (!input.credential) {
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
        method: "GET",
        url: `${BENIN_EMECEF_TEST_BASE_URL}${STATUS_PATH}`,
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${input.credential}`,
        },
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
    const parsed = statusResponseSchema.safeParse(decoded);
    if (!parsed.success) {
      throw new BeninEMecefConnectorError("MALFORMED_RESPONSE", 200);
    }

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
}
