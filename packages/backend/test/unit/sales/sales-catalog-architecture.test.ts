import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const backendRoot = path.join(__dirname, "../../..");
const catalogRoot = path.join(backendRoot, "lambda/domains/sales/catalog");
const catalogSource = readdirSync(catalogRoot)
  .filter((file) => file.endsWith(".ts"))
  .map((file) => readFileSync(path.join(catalogRoot, file), "utf8"))
  .join("\n");
const salesEndpoints = readFileSync(
  path.join(backendRoot, "lib/constructs/domains/sales-endpoints.ts"),
  "utf8",
);

describe("SALES Catalog architecture boundaries", () => {
  test("has no Accounting, Treasury, Projects, Inventory, Customer, or settings dependency", () => {
    for (const forbiddenImport of [
      "domains/accounting",
      "domains/treasury",
      "domains/projects",
      "domains/inventory",
      "sales/customers",
      "sales/settings",
    ]) {
      expect(catalogSource).not.toContain(forbiddenImport);
    }
  });

  test("contains no pricing, tax, stock, invoice, ProductAccess mutation, or Scan implementation", () => {
    for (const forbidden of [
      "unitPrice",
      "taxRate",
      "stockQuantity",
      "invoiceId",
      "ProductAccessRepository",
      "SalesSettingsRepository",
      "ScanCommand",
    ]) {
      expect(catalogSource).not.toContain(forbidden);
    }
  });

  test("registers exactly the six supported routes and no DELETE route", () => {
    const catalogRouteCalls = salesEndpoints
      .split("\n")
      .filter((line) => line.includes('"/sales/items'));
    expect(catalogRouteCalls).toHaveLength(6);
    expect(catalogRouteCalls.every((line) => !line.includes("DELETE"))).toBe(true);
  });
});
