import { SalesInvoiceService } from "@/lambda/domains/sales/invoices/sales-invoice-service";
import {
  SalesInvoiceRepository,
  SalesInvoiceIssueTransactionError,
  SalesInvoiceWriteConflictError,
} from "@/lambda/domains/sales/invoices/sales-invoice-repository";
import { SalesCustomerService } from "@/lambda/domains/sales/customers/sales-customer-service";
import { SalesCatalogItemService } from "@/lambda/domains/sales/catalog/sales-catalog-item-service";
import { SalesSettingsService } from "@/lambda/domains/sales/settings/sales-settings-service";
import { SalesInvoiceCalculator } from "@/lambda/domains/sales/invoices/sales-invoice-calculator";

const timestamp = "2026-08-28T10:00:00.000Z";
const customer = {
  id: "SC-1",
  customerType: "BUSINESS" as const,
  name: "ABC SARL",
  email: "billing@example.com",
  phone: "+22900000000",
  taxIdentifier: "IFU-1",
  billingAddress: { city: "Cotonou", country: "BJ" as const },
  isActive: true,
  version: 1,
  createdAt: timestamp,
  updatedAt: timestamp,
};
const item = {
  id: "SI-1",
  itemType: "SERVICE" as const,
  name: "Conseil",
  unit: "Heure",
  isActive: true,
  version: 1,
  createdAt: timestamp,
  updatedAt: timestamp,
};
const draft = {
  id: "SINV-1",
  status: "DRAFT" as const,
  currency: "EUR",
  customerId: "SC-1",
  customerSnapshot: { name: "ABC SARL" },
  lines: [],
  subtotal: "0",
  taxTotal: "0",
  total: "0",
  lineCount: 0,
  version: 1,
  createdAt: timestamp,
  updatedAt: timestamp,
};

describe("SalesInvoiceService", () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    jest.spyOn(console, "info").mockImplementation(() => undefined);
    jest.spyOn(SalesInvoiceRepository, "create").mockResolvedValue();
    jest.spyOn(SalesInvoiceRepository, "update").mockResolvedValue();
    jest.spyOn(SalesSettingsService, "getSalesSettings").mockResolvedValue({
      orgId: "org-123",
      defaultCurrency: "XOF",
      version: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    jest.spyOn(SalesCustomerService, "get").mockResolvedValue(customer);
    jest.spyOn(SalesCatalogItemService, "get").mockResolvedValue(item);
  });

  test("creates a customer-optional DRAFT using supplied or settings currency", async () => {
    const explicit = await SalesInvoiceService.create("org-123", "user-1", {
      currency: "EUR",
    });
    expect(explicit).toMatchObject({
      status: "DRAFT",
      currency: "EUR",
      lines: [],
      lineCount: 0,
      subtotal: "0",
      taxTotal: "0",
      total: "0",
      version: 1,
    });
    expect(SalesSettingsService.getSalesSettings).not.toHaveBeenCalled();

    const defaulted = await SalesInvoiceService.create("org-123", "user-1", {});
    expect(defaulted.currency).toBe("XOF");
    expect(SalesSettingsService.getSalesSettings).toHaveBeenCalledWith("org-123");
  });

  test("fails cleanly when settings are missing or contain unsupported currency", async () => {
    jest.spyOn(SalesSettingsService, "getSalesSettings").mockResolvedValueOnce(null);
    await expect(
      SalesInvoiceService.create("org-123", "user-1", {}),
    ).rejects.toMatchObject({ messageCode: "SALES_SETTINGS_NOT_FOUND" });
    jest.spyOn(SalesSettingsService, "getSalesSettings").mockResolvedValueOnce({
      orgId: "org-123",
      defaultCurrency: "ZZZ",
      version: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    await expect(
      SalesInvoiceService.create("org-123", "user-1", {}),
    ).rejects.toMatchObject({ messageCode: "UNSUPPORTED_CURRENCY" });
  });

  test("snapshots an active customer and rejects a newly selected inactive customer", async () => {
    const created = await SalesInvoiceService.create("org-123", "user-1", {
      customerId: "SC-1",
      currency: "EUR",
    });
    expect(created.customerSnapshot).toEqual({
      name: "ABC SARL",
      email: "billing@example.com",
      phone: "+22900000000",
      taxIdentifier: "IFU-1",
      billingAddress: { city: "Cotonou", country: "BJ" },
    });
    jest.spyOn(SalesCustomerService, "get").mockResolvedValueOnce({
      ...customer,
      isActive: false,
    });
    await expect(
      SalesInvoiceService.create("org-123", "user-1", {
        customerId: "SC-1",
        currency: "EUR",
      }),
    ).rejects.toMatchObject({ messageCode: "SALES_CUSTOMER_INACTIVE" });
  });

  test("reads snapshots without dereferencing changed, inactive, or missing sources", async () => {
    jest.spyOn(SalesInvoiceRepository, "get").mockResolvedValue(draft);
    const result = await SalesInvoiceService.get("org-123", "SINV-1");
    expect(result.customerSnapshot?.name).toBe("ABC SARL");
    expect(SalesCustomerService.get).not.toHaveBeenCalled();
    expect(SalesCatalogItemService.get).not.toHaveBeenCalled();
  });

  test("changes, refreshes, and clears customer snapshots through versioned PATCH", async () => {
    const get = jest.spyOn(SalesInvoiceRepository, "get");
    get.mockResolvedValueOnce(draft);
    jest.spyOn(SalesCustomerService, "get").mockResolvedValueOnce({
      ...customer,
      name: "ABC INDUSTRIES SARL",
    });
    const refreshed = await SalesInvoiceService.update(
      "org-123",
      "user-1",
      "SINV-1",
      { expectedVersion: 1, customerId: "SC-1" },
    );
    expect(refreshed).toMatchObject({
      customerId: "SC-1",
      customerSnapshot: { name: "ABC INDUSTRIES SARL" },
      version: 2,
    });

    get.mockResolvedValueOnce({ ...refreshed, updatedAt: timestamp });
    const cleared = await SalesInvoiceService.update(
      "org-123",
      "user-1",
      "SINV-1",
      { expectedVersion: 2, customerId: null },
    );
    expect(cleared).not.toHaveProperty("customerId");
    expect(cleared).not.toHaveProperty("customerSnapshot");
    expect(cleared.version).toBe(3);
  });

  test("allows currency change only before lines exist", async () => {
    jest.spyOn(SalesInvoiceRepository, "get").mockResolvedValueOnce(draft);
    await expect(
      SalesInvoiceService.update("org-123", "user-1", "SINV-1", {
        expectedVersion: 1,
        currency: "USD",
      }),
    ).resolves.toMatchObject({ currency: "USD", version: 2 });

    jest.spyOn(SalesInvoiceRepository, "get").mockResolvedValueOnce({
      ...draft,
      lines: [invoiceLine()],
      lineCount: 1,
      subtotal: "10",
      total: "10",
    });
    await expect(
      SalesInvoiceService.update("org-123", "user-1", "SINV-1", {
        expectedVersion: 1,
        currency: "USD",
      }),
    ).rejects.toMatchObject({ messageCode: "INVOICE_CURRENCY_LOCKED" });
  });

  test("adds free-form and Catalog-backed lines with defaults, overrides, totals, ordering, and versions", async () => {
    const get = jest.spyOn(SalesInvoiceRepository, "get");
    get.mockResolvedValueOnce(draft);
    const freeForm = await SalesInvoiceService.addLine(
      "org-123",
      "user-1",
      "SINV-1",
      {
        expectedVersion: 1,
        description: "Déplacement",
        quantity: "1.5",
        unitPrice: "19.99",
        taxRate: "18",
      },
    );
    expect(freeForm).toMatchObject({
      lineCount: 1,
      subtotal: "29.99",
      taxTotal: "5.4",
      total: "35.39",
      version: 2,
    });
    expect(freeForm.lines[0]).toMatchObject({
      position: 1,
      description: "Déplacement",
    });

    get.mockResolvedValueOnce(draft);
    const catalog = await SalesInvoiceService.addLine(
      "org-123",
      "user-1",
      "SINV-1",
      {
        expectedVersion: 1,
        catalogItemId: "SI-1",
        description: "Conseil personnalisé",
        quantity: "2",
        unitPrice: "50",
      },
    );
    expect(catalog.lines[0]).toMatchObject({
      catalogItemId: "SI-1",
      description: "Conseil personnalisé",
      unit: "Heure",
      taxRate: "0",
    });
  });

  test("rejects inactive Catalog references but never rechecks a snapshotted source on line update", async () => {
    jest.spyOn(SalesInvoiceRepository, "get").mockResolvedValueOnce(draft);
    jest.spyOn(SalesCatalogItemService, "get").mockResolvedValueOnce({
      ...item,
      isActive: false,
    });
    await expect(
      SalesInvoiceService.addLine("org-123", "user-1", "SINV-1", {
        expectedVersion: 1,
        catalogItemId: "SI-1",
        quantity: "1",
        unitPrice: "10",
      }),
    ).rejects.toMatchObject({ messageCode: "SALES_ITEM_INACTIVE" });

    const existing = { ...draft, lines: [invoiceLine()], lineCount: 1, subtotal: "10", total: "10" };
    jest.spyOn(SalesInvoiceRepository, "get").mockResolvedValueOnce(existing);
    const updated = await SalesInvoiceService.updateLine(
      "org-123",
      "user-1",
      "SINV-1",
      "SIL-1",
      { expectedVersion: 1, quantity: "2" },
    );
    expect(updated.lines[0]).toMatchObject({ catalogItemId: "SI-1", description: "Old name", subtotal: "20" });
    expect(SalesCatalogItemService.get).toHaveBeenCalledTimes(1);
  });

  test("updates and removes lines while recalculating the whole aggregate", async () => {
    const current = {
      ...draft,
      lines: [invoiceLine(), { ...invoiceLine(), id: "SIL-2", position: 2 }],
      lineCount: 2,
      subtotal: "20",
      total: "20",
    };
    const get = jest.spyOn(SalesInvoiceRepository, "get");
    get.mockResolvedValueOnce(current);
    const updated = await SalesInvoiceService.updateLine(
      "org-123", "user-1", "SINV-1", "SIL-1",
      { expectedVersion: 1, unitPrice: "20", taxRate: "10" },
    );
    expect(updated).toMatchObject({ subtotal: "30", taxTotal: "2", total: "32", version: 2 });

    get.mockResolvedValueOnce({ ...updated, updatedAt: timestamp });
    const removed = await SalesInvoiceService.removeLine(
      "org-123", "user-1", "SINV-1", "SIL-1", 2,
    );
    expect(removed).toMatchObject({ lineCount: 1, subtotal: "10", taxTotal: "0", total: "10", version: 3 });
  });

  test("distinguishes omitted, undefined, null, and replacement line units", async () => {
    const current = {
      ...draft,
      lines: [invoiceLine()],
      lineCount: 1,
      subtotal: "10",
      total: "10",
    };
    const get = jest.spyOn(SalesInvoiceRepository, "get");
    get.mockResolvedValueOnce(current);

    const omitted = await SalesInvoiceService.updateLine(
      "org-123",
      "user-1",
      "SINV-1",
      "SIL-1",
      { expectedVersion: 1, quantity: "2" },
    );
    expect(omitted.lines[0]?.unit).toBe("Heure");

    get.mockResolvedValueOnce(current);
    const undefinedUnit = await SalesInvoiceService.updateLine(
      "org-123",
      "user-1",
      "SINV-1",
      "SIL-1",
      { expectedVersion: 1, unit: undefined, quantity: "2" },
    );
    expect(undefinedUnit.lines[0]?.unit).toBe("Heure");

    get.mockResolvedValueOnce(current);

    const cleared = await SalesInvoiceService.updateLine(
      "org-123",
      "user-1",
      "SINV-1",
      "SIL-1",
      { expectedVersion: 1, unit: null },
    );
    expect(cleared.lines[0]?.unit).toBeUndefined();

    get.mockResolvedValueOnce(current);
    const replaced = await SalesInvoiceService.updateLine(
      "org-123",
      "user-1",
      "SINV-1",
      "SIL-1",
      { expectedVersion: 1, unit: "day" },
    );
    expect(replaced.lines[0]?.unit).toBe("day");
  });

  test("enforces aggregate versions, conditional conflicts, missing lines, and the 100-line bound", async () => {
    jest.spyOn(SalesInvoiceRepository, "get").mockResolvedValue(draft);
    await expect(
      SalesInvoiceService.update("org-123", "user-1", "SINV-1", {
        expectedVersion: 2,
        currency: "USD",
      }),
    ).rejects.toMatchObject({ messageCode: "SALES_INVOICE_VERSION_CONFLICT" });
    await expect(
      SalesInvoiceService.removeLine("org-123", "user-1", "SINV-1", "missing", 1),
    ).rejects.toMatchObject({ messageCode: "SALES_INVOICE_LINE_NOT_FOUND" });

    jest.spyOn(SalesInvoiceRepository, "get").mockResolvedValueOnce({
      ...draft,
      lines: Array.from({ length: 100 }, (_, index) => ({
        ...invoiceLine(), id: `SIL-${index}`, position: index + 1,
      })),
      lineCount: 100,
      subtotal: "1000",
      total: "1000",
    });
    await expect(
      SalesInvoiceService.addLine("org-123", "user-1", "SINV-1", {
        expectedVersion: 1,
        description: "Extra",
        quantity: "1",
        unitPrice: "1",
      }),
    ).rejects.toMatchObject({ messageCode: "MAX_INVOICE_LINES_EXCEEDED" });

    jest.spyOn(SalesInvoiceRepository, "update").mockRejectedValueOnce(
      new SalesInvoiceWriteConflictError(),
    );
    await expect(
      SalesInvoiceService.update("org-123", "user-1", "SINV-1", {
        expectedVersion: 1,
        currency: "USD",
      }),
    ).rejects.toMatchObject({ messageCode: "SALES_INVOICE_VERSION_CONFLICT" });
  });

  test("logs only safe mutation metadata", async () => {
    const info = jest.spyOn(console, "info").mockImplementation(() => undefined);
    await SalesInvoiceService.create("org-123", "user-1", {
      customerId: "SC-1",
      currency: "EUR",
    });
    expect(info).toHaveBeenCalledWith(
      "[SALES_INVOICE_AUDIT]",
      expect.not.objectContaining({
        customerName: expect.anything(),
        email: expect.anything(),
        description: expect.anything(),
      }),
    );
  });

  test("issues a customer-optional zero-total Draft without live reload or recalculation", async () => {
    const current = {
      ...draft,
      customerId: undefined,
      customerSnapshot: undefined,
      lines: [invoiceLine()],
      lineCount: 1,
      subtotal: "0",
      taxTotal: "0",
      total: "0",
    };
    jest.spyOn(SalesInvoiceRepository, "getIssueIdempotency").mockResolvedValue(undefined);
    jest.spyOn(SalesInvoiceRepository, "get").mockResolvedValue(current);
    jest.spyOn(SalesInvoiceRepository, "getSequence").mockResolvedValue({
      exists: false,
      lastValue: "0",
    });
    const transact = jest.spyOn(SalesInvoiceRepository, "issueAtomically").mockResolvedValue();
    const totals = jest.spyOn(SalesInvoiceCalculator, "calculateTotals");
    const lines = jest.spyOn(SalesInvoiceCalculator, "calculateLine");

    const result = await SalesInvoiceService.issue(
      "org-123",
      "user-1",
      "SINV-1",
      {
        expectedVersion: 1,
        clientRequestId: "243dc17a-6c2b-4e2d-87b8-2ad2ae9f12da",
        issueDate: "2026-09-08",
      },
    );

    expect(result).toMatchObject({
      status: "ISSUED",
      invoiceNumber: "00000001",
      issueDate: "2026-09-08",
      version: 2,
      total: "0",
    });
    expect(result.issuedAt).toMatch(/Z$/);
    expect(transact).toHaveBeenCalledWith(expect.objectContaining({
      orgId: "org-123",
      issuedByUserId: "user-1",
      previousSequenceExists: false,
      previousSequenceValue: "0",
      nextSequenceValue: "1",
    }));
    expect(SalesCustomerService.get).not.toHaveBeenCalled();
    expect(SalesCatalogItemService.get).not.toHaveBeenCalled();
    expect(SalesSettingsService.getSalesSettings).not.toHaveBeenCalled();
    expect(totals).not.toHaveBeenCalled();
    expect(lines).not.toHaveBeenCalled();
  });

  test("replays the exact idempotent Issue before stale-version checks", async () => {
    const issued = {
      ...draft,
      status: "ISSUED" as const,
      lines: [invoiceLine()],
      lineCount: 1,
      invoiceNumber: "00000042",
      issueDate: "2026-09-08",
      issuedAt: timestamp,
      version: 2,
    };
    jest.spyOn(SalesInvoiceRepository, "getIssueIdempotency").mockResolvedValue({
      PK: "ORG#org-123",
      SK: "SALES_INVOICE_ISSUE_IDEMPOTENCY#243dc17a-6c2b-4e2d-87b8-2ad2ae9f12da",
      entityType: "SALES_INVOICE_ISSUE_IDEMPOTENCY",
      orgId: "org-123",
      clientRequestId: "243dc17a-6c2b-4e2d-87b8-2ad2ae9f12da",
      invoiceId: "SINV-1",
      issueDate: "2026-09-08",
      originalExpectedVersion: 1,
      invoiceNumber: "00000042",
      createdAt: timestamp,
    });
    jest.spyOn(SalesInvoiceRepository, "get").mockResolvedValue(issued);
    const transact = jest.spyOn(SalesInvoiceRepository, "issueAtomically");

    await expect(SalesInvoiceService.issue(
      "org-123", "user-1", "SINV-1", {
        expectedVersion: 1,
        clientRequestId: "243dc17a-6c2b-4e2d-87b8-2ad2ae9f12da",
        issueDate: "2026-09-08",
      },
    )).resolves.toEqual(issued);
    expect(transact).not.toHaveBeenCalled();
  });

  test("rejects idempotency key reuse with different Invoice semantics", async () => {
    jest.spyOn(SalesInvoiceRepository, "getIssueIdempotency").mockResolvedValue({
      PK: "ORG#org-123",
      SK: "SALES_INVOICE_ISSUE_IDEMPOTENCY#243dc17a-6c2b-4e2d-87b8-2ad2ae9f12da",
      entityType: "SALES_INVOICE_ISSUE_IDEMPOTENCY",
      orgId: "org-123",
      clientRequestId: "243dc17a-6c2b-4e2d-87b8-2ad2ae9f12da",
      invoiceId: "SINV-other",
      issueDate: "2026-09-08",
      originalExpectedVersion: 1,
      invoiceNumber: "00000042",
      createdAt: timestamp,
    });
    await expect(SalesInvoiceService.issue(
      "org-123", "user-1", "SINV-1", {
        expectedVersion: 1,
        clientRequestId: "243dc17a-6c2b-4e2d-87b8-2ad2ae9f12da",
        issueDate: "2026-09-08",
      },
    )).rejects.toMatchObject({ messageCode: "SALES_INVOICE_IDEMPOTENCY_KEY_REUSED" });
  });

  test("retries bounded sequence contention and allocates the reloaded candidate", async () => {
    const current = {
      ...draft,
      lines: [invoiceLine()],
      lineCount: 1,
      subtotal: "10",
      total: "10",
    };
    jest.spyOn(SalesInvoiceRepository, "getIssueIdempotency").mockResolvedValue(undefined);
    jest.spyOn(SalesInvoiceRepository, "get").mockResolvedValue(current);
    jest.spyOn(SalesInvoiceRepository, "getSequence")
      .mockResolvedValueOnce({ exists: true, lastValue: "41" })
      .mockResolvedValueOnce({ exists: true, lastValue: "42" });
    const transact = jest.spyOn(SalesInvoiceRepository, "issueAtomically")
      .mockRejectedValueOnce(new SalesInvoiceIssueTransactionError("SEQUENCE_CONTENTION"))
      .mockResolvedValueOnce();

    const result = await SalesInvoiceService.issue(
      "org-123", "user-1", "SINV-1", {
        expectedVersion: 1,
        clientRequestId: "243dc17a-6c2b-4e2d-87b8-2ad2ae9f12da",
        issueDate: "2026-09-08",
      },
    );
    expect(result.invoiceNumber).toBe("00000043");
    expect(transact).toHaveBeenCalledTimes(2);
  });

  test("concurrent same-request loser resolves through the winning idempotency record", async () => {
    const current = {
      ...draft,
      lines: [invoiceLine()],
      lineCount: 1,
      subtotal: "10",
      total: "10",
    };
    const issued = {
      ...current,
      status: "ISSUED" as const,
      invoiceNumber: "00000042",
      issueDate: "2026-09-08",
      issuedAt: timestamp,
      version: 2,
    };
    const record = {
      PK: "ORG#org-123",
      SK: "SALES_INVOICE_ISSUE_IDEMPOTENCY#243dc17a-6c2b-4e2d-87b8-2ad2ae9f12da",
      entityType: "SALES_INVOICE_ISSUE_IDEMPOTENCY" as const,
      orgId: "org-123",
      clientRequestId: "243dc17a-6c2b-4e2d-87b8-2ad2ae9f12da",
      invoiceId: "SINV-1",
      issueDate: "2026-09-08",
      originalExpectedVersion: 1,
      invoiceNumber: "00000042",
      createdAt: timestamp,
    };
    jest.spyOn(SalesInvoiceRepository, "getIssueIdempotency")
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(record);
    jest.spyOn(SalesInvoiceRepository, "get")
      .mockResolvedValueOnce(current)
      .mockResolvedValueOnce(issued);
    jest.spyOn(SalesInvoiceRepository, "getSequence").mockResolvedValue({
      exists: true,
      lastValue: "41",
    });
    jest.spyOn(SalesInvoiceRepository, "issueAtomically").mockRejectedValue(
      new SalesInvoiceIssueTransactionError("IDEMPOTENCY_CONFLICT"),
    );

    await expect(SalesInvoiceService.issue(
      "org-123", "user-1", "SINV-1", {
        expectedVersion: 1,
        clientRequestId: "243dc17a-6c2b-4e2d-87b8-2ad2ae9f12da",
        issueDate: "2026-09-08",
      },
    )).resolves.toEqual(issued);
  });

  test("stops after four sequence-contention attempts", async () => {
    jest.spyOn(console, "warn").mockImplementation(() => undefined);
    const current = {
      ...draft,
      lines: [invoiceLine()],
      lineCount: 1,
      subtotal: "10",
      total: "10",
    };
    jest.spyOn(SalesInvoiceRepository, "getIssueIdempotency").mockResolvedValue(undefined);
    jest.spyOn(SalesInvoiceRepository, "get").mockResolvedValue(current);
    jest.spyOn(SalesInvoiceRepository, "getSequence").mockResolvedValue({
      exists: true,
      lastValue: "41",
    });
    const transact = jest.spyOn(SalesInvoiceRepository, "issueAtomically").mockRejectedValue(
      new SalesInvoiceIssueTransactionError("SEQUENCE_CONTENTION"),
    );

    await expect(SalesInvoiceService.issue(
      "org-123", "user-1", "SINV-1", {
        expectedVersion: 1,
        clientRequestId: "243dc17a-6c2b-4e2d-87b8-2ad2ae9f12da",
        issueDate: "2026-09-08",
      },
    )).rejects.toMatchObject({ messageCode: "SALES_INVOICE_SEQUENCE_CONTENTION" });
    expect(transact).toHaveBeenCalledTimes(4);
  });

  test("requires lines, protects reviewed version, and rejects a new request for ISSUED", async () => {
    jest.spyOn(SalesInvoiceRepository, "getIssueIdempotency").mockResolvedValue(undefined);
    const get = jest.spyOn(SalesInvoiceRepository, "get");
    get.mockResolvedValueOnce(draft);
    await expect(SalesInvoiceService.issue(
      "org-123", "user-1", "SINV-1", {
        expectedVersion: 1,
        clientRequestId: "243dc17a-6c2b-4e2d-87b8-2ad2ae9f12da",
        issueDate: "2026-09-08",
      },
    )).rejects.toMatchObject({ messageCode: "SALES_INVOICE_HAS_NO_LINES" });

    get.mockResolvedValueOnce({ ...draft, lines: [invoiceLine()], lineCount: 1 });
    await expect(SalesInvoiceService.issue(
      "org-123", "user-1", "SINV-1", {
        expectedVersion: 2,
        clientRequestId: "8066c596-a236-41cf-9061-9ea5a54eab46",
        issueDate: "2026-09-08",
      },
    )).rejects.toMatchObject({ messageCode: "SALES_INVOICE_VERSION_CONFLICT" });

    get.mockResolvedValueOnce({
      ...draft,
      status: "ISSUED",
      lines: [invoiceLine()],
      lineCount: 1,
      invoiceNumber: "00000001",
      issueDate: "2026-09-08",
      issuedAt: timestamp,
      version: 2,
    });
    await expect(SalesInvoiceService.issue(
      "org-123", "user-1", "SINV-1", {
        expectedVersion: 2,
        clientRequestId: "4ca3d105-a325-478a-b3bd-4c4174f47e20",
        issueDate: "2026-09-08",
      },
    )).rejects.toMatchObject({ messageCode: "SALES_INVOICE_ALREADY_ISSUED" });
  });

  test("rejects every S2A mutation once the Invoice is ISSUED", async () => {
    const issued = {
      ...draft,
      status: "ISSUED" as const,
      lines: [invoiceLine()],
      lineCount: 1,
      invoiceNumber: "00000001",
      issueDate: "2026-09-08",
      issuedAt: timestamp,
      version: 2,
    };
    jest.spyOn(SalesInvoiceRepository, "get").mockResolvedValue(issued);
    await expect(SalesInvoiceService.update("org-123", "user-1", "SINV-1", {
      expectedVersion: 2, currency: "USD",
    })).rejects.toMatchObject({ messageCode: "SALES_INVOICE_NOT_EDITABLE" });
    await expect(SalesInvoiceService.addLine("org-123", "user-1", "SINV-1", {
      expectedVersion: 2, description: "Extra", quantity: "1", unitPrice: "1",
    })).rejects.toMatchObject({ messageCode: "SALES_INVOICE_NOT_EDITABLE" });
    await expect(SalesInvoiceService.updateLine("org-123", "user-1", "SINV-1", "SIL-1", {
      expectedVersion: 2, quantity: "2",
    })).rejects.toMatchObject({ messageCode: "SALES_INVOICE_NOT_EDITABLE" });
    await expect(SalesInvoiceService.removeLine(
      "org-123", "user-1", "SINV-1", "SIL-1", 2,
    )).rejects.toMatchObject({ messageCode: "SALES_INVOICE_NOT_EDITABLE" });
    expect(SalesInvoiceRepository.update).not.toHaveBeenCalled();
  });
});

function invoiceLine() {
  return {
    id: "SIL-1",
    position: 1,
    catalogItemId: "SI-1",
    description: "Old name",
    unit: "Heure",
    quantity: "1",
    unitPrice: "10",
    taxRate: "0",
    subtotal: "10",
    taxAmount: "0",
    total: "10",
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}
