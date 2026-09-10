import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const backendRoot = path.join(__dirname, "../../..");
const invoiceRoot = path.join(backendRoot, "lambda/domains/sales/invoices");
const source = readdirSync(invoiceRoot)
  .filter((file) => file.endsWith(".ts"))
  .map((file) => readFileSync(path.join(invoiceRoot, file), "utf8"))
  .join("\n");
const endpoints = readFileSync(
  path.join(backendRoot, "lib/constructs/domains/sales-endpoints.ts"),
  "utf8",
);

describe("SALES Invoice architecture boundaries", () => {
  test("registers fourteen routes including three settlement and three document routes", () => {
    const routeCalls = endpoints
      .split("\n")
      .filter((line) => line.includes('"/sales/invoices'));
    expect(routeCalls).toHaveLength(14);
    expect(routeCalls.filter((line) => line.includes("/issue"))).toHaveLength(1);
    expect(routeCalls.filter((line) => line.includes("/payments"))).toHaveLength(2);
    expect(routeCalls.filter((line) => line.includes("/receivable"))).toHaveLength(1);
    expect(routeCalls.filter((line) => line.includes("/documents/pdf"))).toHaveLength(3);
    expect(routeCalls.some((line) =>
      line.includes("HttpMethod.DELETE") &&
      line.includes('"/sales/invoices/{invoiceId}"') &&
      !line.includes("/lines/"),
    )).toBe(false);
  });

  test("has no Accounting, Treasury, events, queues, or fiscal dependency", () => {
    for (const forbidden of [
      "domains/accounting",
      "domains/treasury",
      "EventBridge",
      "SQS",
      "SNS",
      "eMECeF",
      "discount",
      "ScanCommand",
    ]) {
      expect(source).not.toContain(forbidden);
    }
  });

  test("document rendering uses snapshots and persisted amounts without live reads or recalculation", () => {
    const documentSource = source
      .split("\n")
      .filter((line) => line.includes("Document") || line.includes("Pdf") || line.includes("PDF"))
      .join("\n");
    expect(documentSource).not.toContain("SalesCustomerService");
    expect(documentSource).not.toContain("SalesCatalogItemService");
    expect(documentSource).not.toContain("SalesInvoiceCalculator");
    expect(source).not.toContain("EventBridge");
    expect(source).not.toContain("ScanCommand");
  });

  test("reads Customer, Catalog, and settings only through SALES application services", () => {
    expect(source).toContain("SalesCustomerService");
    expect(source).toContain("SalesCatalogItemService");
    expect(source).toContain("SalesSettingsService");
    expect(source).not.toContain("SalesCustomerRepository");
    expect(source).not.toContain("SalesCatalogItemRepository");
    expect(source).not.toContain("SalesSettingsRepository");
  });
});
