import { readFileSync } from "node:fs";
import path from "node:path";
import {
  PROJECT_ENDPOINT_PERMISSIONS,
  TREASURY_ENDPOINT_PERMISSIONS,
} from "@/lib/constructs/domains/accounting-endpoint-permissions";

interface ReadRouteExpectation {
  handler: string;
  productCode?: "PROJECTS" | "TREASURY";
  route: string;
}

const projectsReadRoutes: ReadRouteExpectation[] = [
  { handler: "get-donors", productCode: "PROJECTS", route: "GET /donors" },
  { handler: "get-projects", route: "GET /projects" },
  { handler: "get-projects", route: "GET /projects/{projectId}" },
  {
    handler: "list-funding-sources",
    route: "GET /projects/{projectId}/funding-sources",
  },
  {
    handler: "list-budget-lines",
    route: "GET /projects/{projectId}/budget-lines",
  },
  { handler: "get-project-report", route: "GET /projects/{projectId}/report" },
  { handler: "list-projects-summary", route: "GET /projects/summary" },
];

const treasuryReadRoutes: ReadRouteExpectation[] = [
  { handler: "list-accounts", route: "GET /treasury/accounts" },
  {
    handler: "list-movements",
    route: "GET /treasury/accounts/{treasuryAccountId}/movements",
  },
  {
    handler: "list-statement-lines",
    route: "GET /treasury/accounts/{treasuryAccountId}/statement-lines",
  },
  { handler: "list-reconciliations", route: "GET /treasury/reconciliations" },
  {
    handler: "get-summary",
    productCode: "TREASURY",
    route: "GET /treasury/summary",
  },
];

const sourceFor = (domain: "projects" | "treasury", handler: string) =>
  readFileSync(
    path.join(
      __dirname,
      `../../../lambda/domains/${domain}/${handler}.ts`,
    ),
    "utf8",
  );

describe("Projects and Treasury read permission inventory", () => {
  test.each(projectsReadRoutes)(
    "$route explicitly requires PROJECTS_READ without expanding ProductAccess",
    ({ handler, productCode }) => {
      const source = sourceFor("projects", handler);

      expect(source).toContain('permission: "PROJECTS_READ"');
      if (productCode) {
        expect(source).toContain(`productCode: "${productCode}"`);
      } else {
        expect(source).not.toContain("productCode:");
      }
    },
  );

  test.each(treasuryReadRoutes)(
    "$route explicitly requires TREASURY_READ without expanding ProductAccess",
    ({ handler, productCode }) => {
      const source = sourceFor("treasury", handler);

      expect(source).toContain('permission: "TREASURY_READ"');
      if (productCode) {
        expect(source).toContain(`productCode: "${productCode}"`);
      } else {
        expect(source).not.toContain("productCode:");
      }
    },
  );

  test("keeps the reviewed write-route debt on legacy write authorization", () => {
    const projectsWriteHandlers = Object.entries(PROJECT_ENDPOINT_PERMISSIONS)
      .filter(([, permission]) => permission === "ACCOUNTING_WRITE")
      .map(([handler]) => handler);
    const treasuryWriteHandlers = Object.entries(TREASURY_ENDPOINT_PERMISSIONS)
      .filter(([, permission]) => permission === "ACCOUNTING_WRITE")
      .map(([handler]) => handler);

    expect(projectsWriteHandlers).toEqual([
      "create-donor",
      "create-project",
      "create-funding-source",
      "create-budget-line",
    ]);
    expect(treasuryWriteHandlers).toEqual([
      "create-account",
      "post-transaction",
      "import-statement-lines",
      "reconcile",
      "cancel-reconciliation",
    ]);
  });
});
