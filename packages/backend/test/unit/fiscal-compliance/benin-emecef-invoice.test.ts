import {
  BeninEMecefConnectorError,
  BeninEMecefTestAdapter,
  BeninInvoiceAttempt,
  BeninInvoiceRequest,
} from "@/lambda/domains/fiscal-compliance/providers/benin-emecef/benin-emecef-test-adapter";
import { FiscalHttpTransport } from "@/lambda/domains/fiscal-compliance/providers/http-transport";
const input = {
  environment: "TEST" as const,
  credential: "explicit-test-secret",
};
const expected = { itemTotals: [2000], total: 2000 };
let sequence = 0;
const invoice = (): BeninInvoiceRequest => ({
  ifu: "test-ifu",
  type: "FV",
  operator: { name: "TEST operator" },
  reference: `pilot-${++sequence}`,
  items: [{ name: "TEST meal", price: 1000, quantity: 2, taxGroup: "B" }],
  payment: [{ name: "ESPECES", amount: 2000 }],
});
const security = {
  dateTime: "05/11/2026 10:00:00",
  qrCode: "test-qr",
  codeMECeFDGI: "test-code",
  counters: "1/1 FV",
  nim: "test-nim",
};
const fiscalTotals = {
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
const response = (body: unknown, status = 200) => ({
  status,
  body: JSON.stringify(body),
});
const setup = (doc = invoice()) => {
  const transport = jest.fn<
    ReturnType<FiscalHttpTransport>,
    Parameters<FiscalHttpTransport>
  >(async (r) =>
    r.method === "POST"
      ? response({ uid: "uid", total: 2000 })
      : r.method === "PUT"
        ? response({ ...security, refundWithAibPayment: false })
        : response(doc),
  );
  return { doc, transport, adapter: new BeninEMecefTestAdapter({ transport }) };
};
test("creates, reads and confirms a reconciled restaurant TEST invoice with security elements", async () => {
  const { doc, transport, adapter } = setup();
  const created = await adapter.createInvoice(
    input,
    new BeninInvoiceAttempt(),
    doc,
    expected,
  );
  expect(created).toMatchObject({ uid: "uid", reconciled: true });
  expect(
    await adapter.confirmInvoice(input, "uid", doc, expected, created),
  ).toEqual({ uid: "uid", ...security, refundWithAibPayment: false });
  expect(
    transport.mock.calls.map(([r]) => [r.method, r.url.split("/api/")[1]]),
  ).toEqual([
    ["POST", "invoice"],
    ["GET", "invoice/uid"],
    ["PUT", "invoice/uid/confirm"],
  ]);
  expect(JSON.parse(transport.mock.calls[0][0].body!)).toEqual(doc);
  await expect(
    adapter.confirmInvoice(input, "uid", doc, expected, created),
  ).rejects.toMatchObject({ code: "RECONCILIATION_FAILED" });
});
test("creates and confirms a reconciled decimal-quantity TEST invoice", async () => {
  const doc = invoice();
  doc.items = [
    { name: "TEST decimal meal", price: 2360, quantity: 2.5, taxGroup: "B" },
  ];
  doc.payment = [{ name: "ESPECES", amount: 5900 }];
  const decimalExpected = { itemTotals: [5900], total: 5900 };
  const transport: jest.MockedFunction<FiscalHttpTransport> = jest.fn(
    async (request) =>
      request.method === "POST"
        ? response({ uid: "decimal-uid", total: 5900 })
        : request.method === "PUT"
          ? response({ ...security, refundWithAibPayment: false })
          : response(doc),
  );
  const adapter = new BeninEMecefTestAdapter({ transport });
  const created = await adapter.createInvoice(
    input,
    new BeninInvoiceAttempt(),
    doc,
    decimalExpected,
  );
  expect(created).toMatchObject({ uid: "decimal-uid", reconciled: true });
  await expect(
    adapter.confirmInvoice(input, "decimal-uid", doc, decimalExpected, created),
  ).resolves.toMatchObject({ uid: "decimal-uid", ...security });
});
test.each(["taxGroups", "invoiceTypes", "paymentTypes"] as const)(
  "reads %s official response",
  async (name) => {
    const body =
      name === "taxGroups"
        ? { a: 0, b: 18 }
        : [
            {
              type: name === "invoiceTypes" ? "FV" : "ESPECES",
              description: "test",
            },
          ];
    const transport = jest.fn(async () => response(body));
    const adapter = new BeninEMecefTestAdapter({ transport });
    const result =
      name === "taxGroups"
        ? await adapter.getTaxGroups(input)
        : name === "invoiceTypes"
          ? await adapter.getInvoiceTypes(input)
          : await adapter.getPaymentTypes(input);
    expect(result).toEqual(body);
    expect(transport.mock.calls).toHaveLength(1);
  },
);
test.each([
  "missing",
  "production",
  "tax",
  "payment",
  "item",
  "unsafe",
] as const)("rejects invalid input %s before HTTP", async (kind) => {
  const { doc, transport, adapter } = setup();
  let auth = { ...input } as {
    environment: "TEST" | "PRODUCTION";
    credential: string | undefined;
  };
  if (kind === "missing") auth.credential = undefined;
  if (kind === "production") auth.environment = "PRODUCTION";
  if (kind === "tax") delete doc.items![0].taxGroup;
  if (kind === "payment") doc.payment![0].amount = 1999;
  if (kind === "item") doc.items![0].price = 999;
  if (kind === "unsafe") doc.items![0].price = Number.MAX_SAFE_INTEGER + 1;
  await expect(
    adapter.createInvoice(auth, new BeninInvoiceAttempt(), doc, expected),
  ).rejects.toBeDefined();
  expect(transport).not.toHaveBeenCalled();
});
test("prevents repeat creation with same attempt or fresh attempt", async () => {
  const { doc, transport, adapter } = setup();
  const attempt = new BeninInvoiceAttempt();
  await adapter.createInvoice(input, attempt, doc, expected);
  for (const ticket of [attempt, new BeninInvoiceAttempt()])
    await expect(
      adapter.createInvoice(input, ticket, doc, expected),
    ).rejects.toMatchObject({ code: "DUPLICATE_ATTEMPT" });
  expect(transport).toHaveBeenCalledTimes(1);
});
test.each(["network", "timeout", "malformed", "http"] as const)(
  "unknown %s outcome never resubmits or leaks errors",
  async (kind) => {
    const doc = invoice();
    const transport: jest.MockedFunction<FiscalHttpTransport> = jest.fn(
      async (r) => {
        if (kind === "timeout")
          return new Promise((_, reject) =>
            r.signal.addEventListener("abort", () =>
              reject(new Error(input.credential)),
            ),
          );
        if (kind === "network") throw new Error(input.credential);
        return kind === "http"
          ? response(input.credential, 500)
          : response({ uid: "uid" });
      },
    );
    const adapter = new BeninEMecefTestAdapter({ transport, timeoutMs: 5 });
    const attempt = new BeninInvoiceAttempt();
    await expect(
      adapter.createInvoice(input, attempt, doc, expected),
    ).rejects.toMatchObject({
      code: "UNKNOWN_OUTCOME",
      message: expect.not.stringContaining(input.credential),
    });
    await expect(
      adapter.createInvoice(input, new BeninInvoiceAttempt(), doc, expected),
    ).rejects.toMatchObject({ code: "DUPLICATE_ATTEMPT" });
    expect(transport).toHaveBeenCalledTimes(1);
  },
);
test("preserves UID on total mismatch and blocks confirmation without cancelling", async () => {
  const { doc, transport, adapter } = setup();
  transport.mockResolvedValueOnce(
    response({ uid: "recoverable-uid", total: 1999 }),
  );
  const created = await adapter.createInvoice(
    input,
    new BeninInvoiceAttempt(),
    doc,
    expected,
  );
  expect(created).toMatchObject({ uid: "recoverable-uid", reconciled: false });
  await expect(
    adapter.confirmInvoice(input, created.uid, doc, expected, created),
  ).rejects.toMatchObject({ code: "RECONCILIATION_FAILED" });
  expect(transport).toHaveBeenCalledTimes(1);
});
test("confirms immediately from exact CREATE fiscal evidence without GET or request body", async () => {
  const doc = invoice();
  const transport = jest.fn<
    ReturnType<FiscalHttpTransport>,
    Parameters<FiscalHttpTransport>
  >(async (request) =>
    request.method === "POST"
      ? response({ uid: "timed-uid", ...fiscalTotals })
      : response(security),
  );
  const adapter = new BeninEMecefTestAdapter({ transport });
  const created = await adapter.createInvoice(
    input,
    new BeninInvoiceAttempt(),
    doc,
    expected,
  );
  await expect(
    adapter.confirmCreatedInvoice(
      input,
      "timed-uid",
      doc,
      expected,
      created,
      fiscalTotals,
    ),
  ).resolves.toEqual({ uid: "timed-uid", ...security });
  expect(transport.mock.calls.map(([request]) => request.method)).toEqual([
    "POST",
    "PUT",
  ]);
  expect(transport.mock.calls[1][0].body).toBeUndefined();
});
test("blocks immediate confirmation when any CREATE fiscal total differs", async () => {
  const doc = invoice();
  const transport = jest.fn(async () =>
    response({ uid: "timed-mismatch", ...fiscalTotals, vab: 304 }),
  );
  const adapter = new BeninEMecefTestAdapter({ transport });
  const created = await adapter.createInvoice(
    input,
    new BeninInvoiceAttempt(),
    doc,
    expected,
  );
  await expect(
    adapter.confirmCreatedInvoice(
      input,
      "timed-mismatch",
      doc,
      expected,
      created,
      fiscalTotals,
    ),
  ).rejects.toMatchObject({ code: "RECONCILIATION_FAILED" });
  expect(transport).toHaveBeenCalledTimes(1);
});
test("blocks confirmation when remote item changes", async () => {
  const { doc, transport, adapter } = setup();
  const created = await adapter.createInvoice(
    input,
    new BeninInvoiceAttempt(),
    doc,
    expected,
  );
  transport.mockResolvedValueOnce(
    response({ ...doc, items: [{ ...doc.items![0], taxGroup: "A" }] }),
  );
  await expect(
    adapter.confirmInvoice(input, "uid", doc, expected, created),
  ).rejects.toMatchObject({ code: "RECONCILIATION_FAILED" });
  expect(transport).toHaveBeenCalledTimes(2);
});
test("cancellation is explicit and returns security elements", async () => {
  const { transport, adapter } = setup();
  expect(transport).not.toHaveBeenCalled();
  expect(await adapter.cancelInvoice(input, "uid/encoded")).toEqual({
    uid: "uid/encoded",
    ...security,
    refundWithAibPayment: false,
  });
  expect(transport.mock.calls[0][0]).toMatchObject({
    method: "PUT",
    url: expect.stringContaining("/uid%2Fencoded/cancel"),
  });
});
test("cancellation failure is unknown and never retried", async () => {
  const transport = jest.fn(async () => {
    throw new Error(input.credential);
  });
  const adapter = new BeninEMecefTestAdapter({ transport });
  await expect(adapter.cancelInvoice(input, "uid")).rejects.toMatchObject({
    code: "UNKNOWN_OUTCOME",
  });
  expect(transport).toHaveBeenCalledTimes(1);
});
test("sanitizes provider business rejection", async () => {
  const transport = jest.fn(async () =>
    response({ errorCode: "SECRET", errorDesc: input.credential }),
  );
  await expect(
    new BeninEMecefTestAdapter({ transport }).getInvoice(input, "uid"),
  ).rejects.toMatchObject({
    code: "PROVIDER_REJECTED",
    message: expect.not.stringContaining(input.credential),
    providerDiagnostic: {
      operation: "GET_INVOICE",
      httpStatus: 200,
      providerErrorCode: "SECRET",
      rejectionCategory: "PROVIDER_ERROR_CODE",
    },
  });
});

test("prepares and confirms an existing invoice without POST", async () => {
  const { doc, transport, adapter } = setup();
  const capability = await adapter.prepareExistingInvoiceConfirmation(
    input,
    "existing-uid",
    doc,
    expected,
    { uid: "existing-uid", total: 2000, reconciled: true },
  );
  await expect(
    adapter.confirmPreparedInvoice(input, capability),
  ).resolves.toEqual({
    uid: "existing-uid",
    ...security,
    refundWithAibPayment: false,
  });
  expect(transport.mock.calls.map(([request]) => request.method)).toEqual([
    "GET",
    "GET",
    "PUT",
  ]);
  expect(
    transport.mock.calls.some(([request]) => request.method === "POST"),
  ).toBe(false);
  await expect(
    adapter.confirmPreparedInvoice(input, capability),
  ).rejects.toMatchObject({
    code: "RECONCILIATION_FAILED",
  });
});

test("normalizes nullable optional GET fields and preserves strict invoice reconciliation", async () => {
  const doc = invoice();
  const sanitizedProviderFixture = {
    ...doc,
    aib: null,
    client: null,
    operator: null,
    type: " FV ",
    paymentUrl: null,
    errorCode: null,
    errorDesc: null,
  };
  const transport = jest.fn<
    ReturnType<FiscalHttpTransport>,
    Parameters<FiscalHttpTransport>
  >(async () => response(sanitizedProviderFixture));
  const adapter = new BeninEMecefTestAdapter({ transport });

  await expect(
    adapter.prepareExistingInvoiceConfirmation(
      input,
      "existing-uid",
      doc,
      expected,
      { uid: "existing-uid", total: 2000, reconciled: true },
    ),
  ).resolves.toMatchObject({
    kind: "BENIN_TEST_PREPARED_CONFIRMATION",
    invoiceType: "FV",
    operatorEvidence: "ABSENT",
  });
  expect(transport).toHaveBeenCalledTimes(1);
  expect(transport.mock.calls[0][0].method).toBe("GET");
});

test("does not convert an unknown GET invoice type to FV", async () => {
  const doc = invoice();
  const transport = jest.fn(async () =>
    response({ ...doc, type: "ZZ", operator: null }),
  );
  const adapter = new BeninEMecefTestAdapter({ transport });

  await expect(adapter.getInvoice(input, "existing-uid")).rejects.toMatchObject(
    {
      code: "MALFORMED_RESPONSE",
      validationIssues: [
        expect.objectContaining({
          path: "type",
          actual: "string",
          observedCode: "ZZ",
        }),
      ],
    },
  );
});

test("TEST resume accepts NA only after independent commercial reconciliation", async () => {
  const doc = invoice();
  const transport = jest.fn(async () =>
    response({ ...doc, type: "NA", operator: null }),
  );
  const adapter = new BeninEMecefTestAdapter({ transport });
  await expect(
    adapter.prepareExistingInvoiceConfirmation(
      input,
      "existing-uid",
      doc,
      expected,
      { uid: "existing-uid", total: 2000, reconciled: true },
    ),
  ).resolves.toMatchObject({ invoiceType: "NA", operatorEvidence: "ABSENT" });
  expect(transport).toHaveBeenCalledTimes(1);
  const mismatch = new BeninEMecefTestAdapter({
    transport: jest.fn(async () =>
      response({
        ...doc,
        type: "NA",
        operator: null,
        payment: [{ name: "ESPECES", amount: 1999 }],
      }),
    ),
  });
  await expect(
    mismatch.prepareExistingInvoiceConfirmation(
      input,
      "existing-uid",
      doc,
      expected,
      { uid: "existing-uid", total: 2000, reconciled: true },
    ),
  ).rejects.toMatchObject({ code: "RECONCILIATION_FAILED" });
});

test("reports malformed GET field metadata without rejected values or credentials", async () => {
  const doc = invoice();
  const rejectedValue = "private-provider-value";
  const transport = jest.fn(async () =>
    response({
      ...doc,
      items: [{ ...doc.items![0], price: rejectedValue }],
    }),
  );
  const adapter = new BeninEMecefTestAdapter({ transport });

  let captured: unknown;
  try {
    await adapter.getInvoice(input, "existing-uid");
  } catch (error) {
    captured = error;
  }
  expect(captured).toBeInstanceOf(BeninEMecefConnectorError);
  expect(captured).toMatchObject({
    code: "MALFORMED_RESPONSE",
    validationIssues: [
      {
        path: "items.0.price",
        expected: "number",
        actual: "string",
        category: "INVALID_TYPE",
      },
    ],
  });
  expect(JSON.stringify(captured)).not.toContain(rejectedValue);
  expect(JSON.stringify(captured)).not.toContain(input.credential);
});

test("resume preparation rejects mismatched checkpoint or remote invoice before PUT", async () => {
  const { doc, transport, adapter } = setup();
  await expect(
    adapter.prepareExistingInvoiceConfirmation(
      input,
      "existing-uid",
      doc,
      expected,
      {
        uid: "other-uid",
        total: 2000,
        reconciled: true,
      },
    ),
  ).rejects.toMatchObject({ code: "RECONCILIATION_FAILED" });
  expect(transport).not.toHaveBeenCalled();

  transport.mockResolvedValueOnce(
    response({ ...doc, items: [{ ...doc.items![0], taxGroup: "A" }] }),
  );
  await expect(
    adapter.prepareExistingInvoiceConfirmation(
      input,
      "existing-uid",
      doc,
      expected,
      {
        uid: "existing-uid",
        total: 2000,
        reconciled: true,
      },
    ),
  ).rejects.toMatchObject({ code: "RECONCILIATION_FAILED" });
  expect(transport.mock.calls.map(([request]) => request.method)).toEqual([
    "GET",
  ]);
});

test.each([
  [401, {}, "AUTHENTICATION"],
  [503, {}, "HTTP"],
  [200, {}, "RESPONSE_VALIDATION"],
  [200, { errorCode: "20", errorDesc: "confidential" }, "PROVIDER_REJECTION"],
] as const)(
  "preserves safe confirmation diagnostics for HTTP %s",
  async (status, body, category) => {
    const doc = invoice();
    const transport = jest.fn(
      async (request: Parameters<FiscalHttpTransport>[0]) =>
        request.method === "POST"
          ? response({ uid: "uid", ...fiscalTotals })
          : response(body, status),
    );
    const adapter = new BeninEMecefTestAdapter({ transport });
    const created = await adapter.createInvoice(
      input,
      new BeninInvoiceAttempt(),
      doc,
      expected,
    );
    let failure: unknown;
    try {
      await adapter.confirmCreatedInvoice(
        input,
        "uid",
        doc,
        expected,
        created,
        fiscalTotals,
      );
    } catch (error) {
      failure = error;
    }
    expect(failure).toMatchObject({
      code: "UNKNOWN_OUTCOME",
      mutationDiagnostic: {
        operation: "CONFIRM_INVOICE",
        environment: "TEST",
        category,
        httpStatus: status,
        sent: true,
        durationMs: expect.any(Number),
      },
    });
    expect(JSON.stringify(failure)).not.toContain("confidential");
    expect(JSON.stringify(failure)).not.toContain(input.credential);
    await expect(
      adapter.confirmCreatedInvoice(
        input,
        "uid",
        doc,
        expected,
        created,
        fiscalTotals,
      ),
    ).rejects.toMatchObject({ code: "RECONCILIATION_FAILED" });
    expect(transport).toHaveBeenCalledTimes(2);
  },
);

test("ambiguous confirmation transport failure preserves metadata and never retries", async () => {
  const doc = invoice();
  const transport = jest.fn(
    async (request: Parameters<FiscalHttpTransport>[0]) => {
      if (request.method === "POST")
        return response({ uid: "uid", ...fiscalTotals });
      throw new Error(input.credential);
    },
  );
  const adapter = new BeninEMecefTestAdapter({ transport });
  const created = await adapter.createInvoice(
    input,
    new BeninInvoiceAttempt(),
    doc,
    expected,
  );
  await expect(
    adapter.confirmCreatedInvoice(
      input,
      "uid",
      doc,
      expected,
      created,
      fiscalTotals,
    ),
  ).rejects.toMatchObject({
    code: "UNKNOWN_OUTCOME",
    mutationDiagnostic: { category: "TRANSPORT", sent: true },
  });
  expect(transport).toHaveBeenCalledTimes(2);
});
