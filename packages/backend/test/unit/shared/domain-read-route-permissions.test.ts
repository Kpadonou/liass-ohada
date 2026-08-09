import { readFileSync } from "node:fs";
import path from "node:path";

interface RouteExpectation {
  handler: string;
  route: string;
}

const projectsReadRoutes: RouteExpectation[] = [
  { handler: "get-donors", route: "GET /donors" },
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

const sourceFor = (
  domain: "accounting" | "projects" | "treasury",
  handler: string,
) =>
  readFileSync(
    path.join(
      __dirname,
      `../../../lambda/domains/${domain}/${handler}.ts`,
    ),
    "utf8",
  );

const endpointSourceFor = (domain: "accounting" | "project" | "treasury") =>
  readFileSync(
    path.join(
      __dirname,
      `../../../lib/constructs/domains/${domain}-endpoints.ts`,
    ),
    "utf8",
  );

const routesFromEndpointSource = (source: string) =>
  Array.from(
    source.matchAll(
      /map\(\s*apigw\.HttpMethod\.(GET|POST|PUT|PATCH|DELETE),\s*"([^"]+)",\s*"([^"]+)"/g,
    ),
    ([, method, routePath, handler]) => ({
      handler,
      route: `${method} ${routePath}`,
    }),
  );

const accountingPermissions = Object.fromEntries(
  Array.from(
    readFileSync(
      path.join(
        __dirname,
        "../../../lib/constructs/domains/accounting-endpoint-permissions.ts",
      ),
      "utf8",
    ).matchAll(/\s+"([^"]+)": "(ACCOUNTING_READ|ACCOUNTING_WRITE)"/g),
    ([, handler, permission]) => [handler, permission],
  ),
);

describe("Accounting product route permission inventory", () => {
  test.each(projectsReadRoutes)(
    "$route explicitly requires PROJECTS_READ and ACCOUNTING ProductAccess",
    ({ handler }) => {
      const source = sourceFor("projects", handler);

      expect(source).toContain('permission: "PROJECTS_READ"');
      expect(source).toContain('productCode: "ACCOUNTING"');
    },
  );

  test.each(treasuryReadRoutes)(
    "$route explicitly requires TREASURY_READ and ACCOUNTING ProductAccess",
    ({ handler }) => {
      const source = sourceFor("treasury", handler);

      expect(source).toContain('permission: "TREASURY_READ"');
      expect(source).toContain('productCode: "ACCOUNTING"');
    },
  );

  test.each(projectsWriteRoutes)(
    "$route explicitly requires PROJECTS_WRITE and ACCOUNTING ProductAccess",
    ({ handler }) => {
      const source = sourceFor("projects", handler);

      expect(source).toContain('permission: "PROJECTS_WRITE"');
      expect(source).toContain('productCode: "ACCOUNTING"');
    },
  );

  test.each(treasuryWriteRoutes)(
    "$route explicitly requires TREASURY_WRITE and ACCOUNTING ProductAccess",
    ({ handler }) => {
      const source = sourceFor("treasury", handler);

      expect(source).toContain('permission: "TREASURY_WRITE"');
      expect(source).toContain('productCode: "ACCOUNTING"');
    },
  );

  test("keeps the route inventory at Accounting Core 50/50, Projects 11/11, and Treasury 10/10", () => {
    const accountingRoutes = routesFromEndpointSource(
      endpointSourceFor("accounting"),
    );
    const projectRoutes = routesFromEndpointSource(
      endpointSourceFor("project"),
    );
    const treasuryRoutes = routesFromEndpointSource(
      endpointSourceFor("treasury"),
    );

    expect(accountingRoutes).toHaveLength(50);
    expect(projectRoutes).toEqual([
      ...projectsWriteRoutes.slice(0, 1),
      ...projectsReadRoutes.slice(0, 1),
      ...projectsWriteRoutes.slice(1, 2),
      ...projectsReadRoutes.slice(1, 3),
      ...projectsWriteRoutes.slice(2, 3),
      ...projectsReadRoutes.slice(3, 4),
      ...projectsWriteRoutes.slice(3, 4),
      ...projectsReadRoutes.slice(4),
    ]);
    expect(treasuryRoutes).toEqual([
      treasuryReadRoutes[0],
      treasuryWriteRoutes[0],
      treasuryReadRoutes[1],
      treasuryWriteRoutes[1],
      treasuryReadRoutes[2],
      treasuryWriteRoutes[2],
      treasuryWriteRoutes[3],
      treasuryReadRoutes[3],
      treasuryWriteRoutes[4],
      treasuryReadRoutes[4],
    ]);

    expect(Object.keys(accountingPermissions)).toHaveLength(48);
    for (const { handler } of accountingRoutes) {
      const source = sourceFor("accounting", handler);
      const permission = accountingPermissions[handler];

      expect(permission).toMatch(/^ACCOUNTING_(READ|WRITE)$/);
      expect(source).toContain(`permission: "${permission}"`);
      expect(source).toContain('productCode: "ACCOUNTING"');
    }
  });

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
