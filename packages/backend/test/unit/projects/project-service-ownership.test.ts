import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const backendRoot = path.join(__dirname, "../../..");
const projectServicePath = path.join(
  backendRoot,
  "lambda/domains/projects/services/project-service.ts",
);
const budgetServicePath = path.join(
  backendRoot,
  "lambda/domains/projects/services/budget-service.ts",
);
const referenceServicePath = path.join(
  backendRoot,
  "lambda/domains/projects/references/project-accounting-reference-service.ts",
);
const projectHandlers = [
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
].map((handler) =>
  readFileSync(
    path.join(backendRoot, `lambda/domains/projects/${handler}.ts`),
    "utf8",
  ),
);

describe("Project Accounting service ownership", () => {
  test("keeps ProjectService and BudgetService implementations in the Projects domain", () => {
    expect(existsSync(projectServicePath)).toBe(true);
    expect(existsSync(budgetServicePath)).toBe(true);
    expect(readFileSync(projectServicePath, "utf8")).toContain(
      "export class ProjectService",
    );
    expect(readFileSync(budgetServicePath, "utf8")).toContain(
      "export class BudgetService",
    );
  });

  test("does not retain shared-path implementations or compatibility exports", () => {
    expect(
      existsSync(
        path.join(backendRoot, "lambda/shared/services/project-service.ts"),
      ),
    ).toBe(false);
    expect(
      existsSync(
        path.join(backendRoot, "lambda/shared/services/budget-service.ts"),
      ),
    ).toBe(false);
  });

  test("uses only canonical Project Accounting service imports", () => {
    const handlerSources = projectHandlers.join("\n");
    expect(handlerSources).not.toContain("shared/services/project-service");
    expect(handlerSources).toContain(
      "domains/projects/services/project-service",
    );

    const referenceSource = readFileSync(referenceServicePath, "utf8");
    expect(referenceSource).not.toContain("shared/services/budget-service");
    expect(referenceSource).toContain(
      "domains/projects/services/budget-service",
    );
  });
});
