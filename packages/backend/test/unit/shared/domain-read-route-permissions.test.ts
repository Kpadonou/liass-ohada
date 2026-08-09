import { readFileSync } from "node:fs";
import path from "node:path";

interface RouteExpectation {
  handler: string;
  productCode?: "ACCOUNTING";
  route: string;
}

const projectsReadRoutes: RouteExpectation[] = [
  { handler: "get-donors", productCode: "ACCOUNTING", route: "GET /donors" },
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

const projectsWriteRoutes: RouteExpectation[] = [
  { handler: "create-donor", route: "POST /donors" },
  { handler: "create-project", route: "POST /projects" },
  {
    handler: "create-funding-source",
    route: "POST /projects/{projectId}/funding-sources",
  },
  {
    handler: "create-budget-line",
    route: "POST /projects/{projectId}/budget-lines",
  },
];

const treasuryReadRoutes: RouteExpectation[] = [
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
    productCode: "ACCOUNTING",
    route: "GET /treasury/summary",
  },
];

const treasuryWriteRoutes: RouteExpectation[] = [
  { handler: "create-account", route: "POST /treasury/accounts" },
  { handler: "post-transaction", route: "POST /treasury/transactions" },
  {
    handler: "import-statement-lines",
    route: "POST /treasury/accounts/{treasuryAccountId}/statement-lines/import",
  },
  { handler: "reconcile", route: "POST /treasury/reconciliations" },
  {
    handler: "cancel-reconciliation",
    route: "POST /treasury/reconciliations/{matchId}/cancel",
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

describe("Projects and Treasury route permission inventory", () => {
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

  test.each(projectsWriteRoutes)(
    "$route explicitly requires PROJECTS_WRITE without expanding ProductAccess",
    ({ handler }) => {
      const source = sourceFor("projects", handler);

      expect(source).toContain('permission: "PROJECTS_WRITE"');
      expect(source).not.toContain("productCode:");
    },
  );

  test.each(treasuryWriteRoutes)(
    "$route explicitly requires TREASURY_WRITE without expanding ProductAccess",
    ({ handler }) => {
      const source = sourceFor("treasury", handler);

      expect(source).toContain('permission: "TREASURY_WRITE"');
      expect(source).not.toContain("productCode:");
    },
  );

  test("keeps Accounting-named permissions out of Projects and Treasury handlers", () => {
    const routeFiles = [
      ...projectsReadRoutes.map(({ handler }) => ["projects", handler] as const),
      ...projectsWriteRoutes.map(({ handler }) => ["projects", handler] as const),
      ...treasuryReadRoutes.map(({ handler }) => ["treasury", handler] as const),
      ...treasuryWriteRoutes.map(({ handler }) => ["treasury", handler] as const),
    ];

    for (const [domain, handler] of routeFiles) {
      const source = sourceFor(domain, handler);
      expect(source).not.toContain('permission: "ACCOUNTING_READ"');
      expect(source).not.toContain('permission: "ACCOUNTING_WRITE"');
    }
  });
});
