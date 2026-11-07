import { BeninEMecefTestAdapter } from "@/lambda/domains/fiscal-compliance/providers/benin-emecef/benin-emecef-test-adapter";
import { FiscalComplianceConnectionVerifier } from "@/lambda/domains/fiscal-compliance/connection-verification";
import { beninStatusEndpoint } from "@/lambda/domains/fiscal-compliance/providers/benin-emecef/environments";
import {
  evaluateDgiStatus,
  initialVerification,
} from "@/lambda/shared/services/fiscal-verification-model";
import type { FiscalHttpTransport } from "@/lambda/domains/fiscal-compliance/providers/http-transport";

const now = "2026-11-07T12:00:00.000Z";
const binding = {
  orgId: "synthetic-org",
  connectionId: "604cf1af-cfe2-4fab-a266-a76e92b5d0cb",
  environment: "TEST" as const,
  configurationVersion: 1,
  configurationDigest: "a".repeat(64),
  credentialReference: "internal-only",
  credentialVersion: 1 as const,
  credentialStorageVersion: 1,
  identity: {
    reference: "f71cb01f-71e4-43a8-a05b-4484033fdc88",
    version: "1",
    digest: "b".repeat(64),
    selectionVersion: 1,
  },
};
const base = () =>
  initialVerification("35802d57-0418-4825-82ae-c3bf681bcb60", binding, now);
const evidence = {
  status: true,
  ifu: "synthetic-ifu",
  nim: "synthetic-nim",
  tokenValid: "2026-11-08T13:00:00+01:00",
  serverDateTime: now,
  emcfList: [{ nim: "synthetic-nim", status: "UNKNOWN_DGI_STATUS" }],
};
const read = (transport: FiscalHttpTransport) =>
  FiscalComplianceConnectionVerifier.withTransport(transport).readStatus({
    environment: "TEST",
    credential: { environment: "TEST", value: "a.b.synthetic" },
  });
beforeEach(() => {
  jest
    .spyOn(globalThis, "fetch")
    .mockRejectedValue(new Error("LIVE_NETWORK_FORBIDDEN"));
});
afterEach(() => {
  expect(fetch).not.toHaveBeenCalled();
  jest.restoreAllMocks();
});
test("official TEST request is GET status only; approved technical correspondence never grants issuance", async () => {
  const transport = jest
    .fn<ReturnType<FiscalHttpTransport>, Parameters<FiscalHttpTransport>>()
    .mockResolvedValue({ status: 200, body: JSON.stringify(evidence) });
  const result = evaluateDgiStatus(
    base(),
    await read(transport),
    evidence.ifu,
    evidence.ifu,
    evidence.nim,
    now,
  );
  expect(transport.mock.calls[0][0]).toMatchObject({
    method: "GET",
    url: beninStatusEndpoint("TEST"),
  });
  expect(result.status).toBe("VERIFIED_TEST");
  expect(result.tokenValidUntil).toBe("2026-11-08T12:00:00.000Z");
  expect(result.checks).toMatchObject({
    technicallyVerified: true,
    nimCorrespondence: "MATCH",
    emcfAssociation: "UNVERIFIED",
    establishmentBinding: "UNVERIFIED",
    executionAuthorized: false,
    issuanceEligible: false,
    productionEligible: false,
  });
});
test.each([
  [{ status: false }, "PROVIDER_UNAVAILABLE"],
  [{ status: undefined }, "VERIFICATION_INCOMPLETE"],
  [{ tokenValid: "2026-11-06T12:00:00Z" }, "CREDENTIAL_EXPIRED"],
  [{ tokenValid: undefined }, "VERIFICATION_INCOMPLETE"],
  [{ ifu: undefined }, "VERIFICATION_INCOMPLETE"],
  [{ ifu: "another" }, "IFU_MISMATCH"],
  [{ nim: undefined }, "EMCF_ASSOCIATION_UNVERIFIED"],
  [{ nim: "different-top-level" }, "EMCF_ASSOCIATION_UNVERIFIED"],
  [{ emcfList: [] }, "EMCF_ASSOCIATION_UNVERIFIED"],
  [{ emcfList: null }, "EMCF_ASSOCIATION_UNVERIFIED"],
  [
    { emcfList: [{ nim: evidence.nim }, { nim: evidence.nim }] },
    "EMCF_ASSOCIATION_UNVERIFIED",
  ],
] as const)(
  "incomplete, invalid or ambiguous evidence is never fully ready: %j",
  async (overrides, status) => {
    const transport: FiscalHttpTransport = async () => ({
      status: 200,
      body: JSON.stringify({ ...evidence, ...overrides }),
    });
    const result = evaluateDgiStatus(
      base(),
      await read(transport),
      evidence.ifu,
      evidence.ifu,
      evidence.nim,
      now,
    );
    expect(result.status).toBe(status);
    expect(result.checks.issuanceEligible).toBe(false);
  },
);
test("multiple devices may establish literal NIM correspondence but never outlet ownership", async () => {
  const data = {
    ...evidence,
    emcfList: [
      { nim: "another" },
      { nim: evidence.nim, shopName: "Not ownership evidence" },
    ],
  };
  const result = evaluateDgiStatus(
    base(),
    await read(async () => ({ status: 200, body: JSON.stringify(data) })),
    evidence.ifu,
    evidence.ifu,
    evidence.nim,
    now,
  );
  expect(result.status).toBe("VERIFIED_TEST");
  expect(result.reportedDeviceCount).toBe(2);
  expect(result.checks.establishmentBinding).toBe("UNVERIFIED");
  expect(JSON.stringify(result)).not.toContain("shopName");
});
test.each([
  JSON.stringify({ ...evidence, tokenValid: true }),
  JSON.stringify({ ...evidence, tokenValid: "not-a-date" }),
  JSON.stringify({ ...evidence, unsupported: "a.b.synthetic" }),
  "not JSON",
])(
  "rejects invalid schema without returning raw provider data",
  async (body) => {
    await expect(
      read(async () => ({ status: 200, body })),
    ).rejects.toMatchObject({ code: "MALFORMED_RESPONSE" });
  },
);
test.each([
  [401, "AUTHENTICATION_FAILED"],
  [403, "ACCESS_FORBIDDEN"],
  [429, "UNEXPECTED_HTTP_STATUS"],
  [500, "UNEXPECTED_HTTP_STATUS"],
])("handles HTTP %s without secret diagnostics", async (status, code) => {
  await expect(
    read(async () => ({ status: Number(status), body: "a.b.synthetic" })),
  ).rejects.toMatchObject({ code });
});
test("timeout and network error have distinct sanitized connector codes", async () => {
  const transport: FiscalHttpTransport = (request) =>
    new Promise((_, reject) =>
      request.signal.addEventListener("abort", () =>
        reject(new Error("private")),
      ),
    );
  await expect(
    new BeninEMecefTestAdapter({
      transport,
      timeoutMs: 1,
    }).getVerificationStatus({
      environment: "TEST",
      credential: "a.b.synthetic",
    }),
  ).rejects.toMatchObject({ code: "TIMEOUT" });
  await expect(
    read(async () => {
      throw new Error("a.b.synthetic");
    }),
  ).rejects.toMatchObject({ code: "NETWORK_FAILURE" });
});
test("both official mappings are fixed; production dispatch and environment crossover are rejected", async () => {
  expect(beninStatusEndpoint("TEST")).toBe(
    "https://developper.impots.bj/sygmef-emcf/api/info/status",
  );
  expect(beninStatusEndpoint("PRODUCTION")).toBe(
    "https://sygmef.impots.bj/emcf/api/info/status",
  );
  expect(() =>
    beninStatusEndpoint("https://customer.example" as "TEST"),
  ).toThrow();
  const transport = jest.fn<
    ReturnType<FiscalHttpTransport>,
    Parameters<FiscalHttpTransport>
  >();
  const port = FiscalComplianceConnectionVerifier.withTransport(transport);
  expect(() =>
    port.readStatus({
      environment: "PRODUCTION",
      credential: { environment: "PRODUCTION", value: "a.b.synthetic" },
    }),
  ).toThrow("ENVIRONMENT_NOT_ALLOWED");
  expect(() =>
    port.readStatus({
      environment: "TEST",
      credential: { environment: "PRODUCTION", value: "a.b.synthetic" },
    }),
  ).toThrow("ENVIRONMENT_NOT_ALLOWED");
  expect(() =>
    port.readStatus({
      environment: undefined as unknown as "TEST",
      credential: { environment: "TEST", value: "a.b.synthetic" },
    }),
  ).toThrow();
  expect(transport).not.toHaveBeenCalled();
});
