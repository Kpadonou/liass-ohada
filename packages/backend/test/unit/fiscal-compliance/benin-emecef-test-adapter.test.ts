import {
  BENIN_EMECEF_TEST_BASE_URL,
  BeninEMecefConnectorError,
  BeninEMecefTestAdapter,
} from "@/lambda/domains/fiscal-compliance/providers/benin-emecef/benin-emecef-test-adapter";
import {
  FiscalHttpRequest,
  FiscalHttpTransport,
} from "@/lambda/domains/fiscal-compliance/providers/http-transport";

const credential = "unit-test-secret-that-must-never-escape";
const responseBody = JSON.stringify({
  status: true,
  version: "test-version",
  ifu: "restricted-ifu",
  nim: "restricted-nim",
  tokenValid: "2026-11-05T10:00:00+01:00",
  serverDateTime: "2026-11-04T10:00:00+01:00",
  emcfList: [
    {
      nim: "restricted-device-nim",
      status: "ACTIF",
      shopName: "Restricted shop",
      address1: null,
      address2: null,
      address3: null,
      contact1: null,
      contact2: null,
      contact3: null,
    },
  ],
});

const successfulTransport = (): jest.MockedFunction<FiscalHttpTransport> =>
  jest.fn<ReturnType<FiscalHttpTransport>, Parameters<FiscalHttpTransport>>(
    async () => ({ status: 200, body: responseBody }),
  );

const expectConnectorError = async (
  promise: Promise<unknown>,
  code: BeninEMecefConnectorError["code"],
  httpStatus?: number,
) => {
  await expect(promise).rejects.toMatchObject({
    name: "BeninEMecefConnectorError",
    code,
    ...(httpStatus === undefined ? {} : { httpStatus }),
  });
};

test("returns a sanitized TEST status summary and sends Bearer authentication", async () => {
  const transport = successfulTransport();
  const result = await new BeninEMecefTestAdapter({ transport }).getStatus({
    environment: "TEST",
    credential,
  });

  expect(transport).toHaveBeenCalledTimes(1);
  const request = transport.mock.calls[0][0];
  expect(request).toMatchObject({
    method: "GET",
    url: `${BENIN_EMECEF_TEST_BASE_URL}/api/info/status`,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${credential}`,
    },
  });
  expect(result).toEqual({
    environment: "TEST",
    provider: "BENIN_E_MECEF",
    reachable: true,
    serviceAvailable: true,
    apiVersion: "test-version",
    tokenValidUntil: "2026-11-05T10:00:00+01:00",
    serverDateTime: "2026-11-04T10:00:00+01:00",
    configuredDeviceCount: 1,
  });
  expect(JSON.stringify(result)).not.toMatch(
    /restricted-ifu|restricted-nim|Restricted shop|secret/i,
  );
});

test("fails closed when the credential is missing", async () => {
  const transport = successfulTransport();
  await expectConnectorError(
    new BeninEMecefTestAdapter({ transport }).getStatus({
      environment: "TEST",
      credential: undefined,
    }),
    "MISSING_CREDENTIAL",
  );
  expect(transport).not.toHaveBeenCalled();
});

test.each([
  [401, "AUTHENTICATION_FAILED"],
  [403, "ACCESS_FORBIDDEN"],
] as const)(
  "classifies HTTP %s without exposing its body",
  async (status, code) => {
    const transport: FiscalHttpTransport = async () => ({
      status,
      body: `provider echoed ${credential}`,
    });
    const promise = new BeninEMecefTestAdapter({ transport }).getStatus({
      environment: "TEST",
      credential,
    });
    await expectConnectorError(promise, code, status);
    await promise.catch((error) => {
      expect(JSON.stringify(error)).not.toContain(credential);
      expect(error.message).not.toContain(credential);
    });
  },
);

test("classifies a bounded timeout", async () => {
  const transport: FiscalHttpTransport = (request) =>
    new Promise((_, reject) => {
      request.signal.addEventListener("abort", () =>
        reject(new Error(`aborted ${credential}`)),
      );
    });
  await expectConnectorError(
    new BeninEMecefTestAdapter({ transport, timeoutMs: 5 }).getStatus({
      environment: "TEST",
      credential,
    }),
    "TIMEOUT",
  );
});

test("classifies network, DNS or TLS transport failures without leaking details", async () => {
  const transport: FiscalHttpTransport = async () => {
    throw new Error(`TLS failed with ${credential}`);
  };
  const promise = new BeninEMecefTestAdapter({ transport }).getStatus({
    environment: "TEST",
    credential,
  });
  await expectConnectorError(promise, "NETWORK_FAILURE");
  await promise.catch((error) => {
    expect(error.message).not.toContain(credential);
    expect(error).not.toHaveProperty("cause");
  });
});

test.each([
  [200, "not-json", "MALFORMED_RESPONSE"],
  [200, JSON.stringify({ status: "yes" }), "MALFORMED_RESPONSE"],
  [429, `provider echoed ${credential}`, "UNEXPECTED_HTTP_STATUS"],
] as const)(
  "classifies invalid provider response %#",
  async (status, body, code) => {
    const transport: FiscalHttpTransport = async () => ({ status, body });
    const promise = new BeninEMecefTestAdapter({ transport }).getStatus({
      environment: "TEST",
      credential,
    });
    await expectConnectorError(promise, code, status);
    await promise.catch((error) =>
      expect(JSON.stringify(error)).not.toContain(credential),
    );
  },
);

test("rejects PRODUCTION before credential or transport selection", async () => {
  const transport = successfulTransport();
  await expectConnectorError(
    new BeninEMecefTestAdapter({ transport }).getStatus({
      environment: "PRODUCTION",
      credential,
    }),
    "ENVIRONMENT_NOT_ALLOWED",
  );
  expect(transport).not.toHaveBeenCalled();
});

test("never logs or serializes the credential when the provider response is sensitive", async () => {
  const info = jest.spyOn(console, "info").mockImplementation(() => undefined);
  const error = jest
    .spyOn(console, "error")
    .mockImplementation(() => undefined);
  const transport = jest.fn(async (_request: FiscalHttpRequest) => ({
    status: 500,
    body: credential,
  }));
  const promise = new BeninEMecefTestAdapter({ transport }).getStatus({
    environment: "TEST",
    credential,
  });
  await expectConnectorError(promise, "UNEXPECTED_HTTP_STATUS", 500);
  expect(JSON.stringify(info.mock.calls)).not.toContain(credential);
  expect(JSON.stringify(error.mock.calls)).not.toContain(credential);
  info.mockRestore();
  error.mockRestore();
});
