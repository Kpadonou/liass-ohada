import { readFileSync } from "node:fs";
import path from "node:path";

const productionSources = [
  "../../../lambda/domains/projects/services/project-service.ts",
  "../../../lambda/domains/projects/services/budget-service.ts",
  ...[
    "create-budget-line",
    "create-donor",
    "create-funding-source",
    "create-project",
    "get-donors",
    "get-project-report",
    "get-projects",
    "list-budget-lines",
    "list-funding-sources",
    "list-projects-summary",
  ].map((handler) => `../../../lambda/domains/projects/${handler}.ts`),
].map((relativePath) =>
  readFileSync(path.join(__dirname, relativePath), "utf8"),
);

describe("Project Accounting reporting boundary", () => {
  test("Project Accounting consumes the Accounting-owned reporting service", () => {
    expect(productionSources.join("\n")).toContain(
      'from "@/lambda/domains/accounting/reporting/accounting-project-reporting-service"',
    );
  });

  test.each([
    "GSI4",
    "GSI4PK",
    "GSI4SK",
    "KeyFactory.gsi4PK",
    "KeyFactory.projectYearPrefix",
    "EntryLineSchema",
  ])("Project Accounting production code does not reference %s", (forbidden) => {
    for (const source of productionSources) {
      expect(source).not.toContain(forbidden);
    }
  });
});
