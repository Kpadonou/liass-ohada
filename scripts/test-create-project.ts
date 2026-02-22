process.env.TABLE_NAME = "liass-ohada-dev-accounting-table";
process.env.LOCALSTACK_URL = "http://localhost:4566";

import { handler as createProject } from "../lambda/domains/projects/create-project";

const commonContext: any = {
  requestContext: { authorizer: { claims: { orgId: "org-test-dash" } } },
  headers: { "Accept-Language": "en" },
};

const payload = {
  projectCode: "TESTPRJ",
  name: "Test Project",
  donorId: "DONOR-001",
  managerId: "USER-1",
  startDate: "2026-01-01",
  budget: 100000,
};

(async () => {
  console.log("Creating first project (should succeed)...");
  const res1 = await createProject({
    ...commonContext,
    body: JSON.stringify(payload),
  } as any);
  console.log("First response:", res1);

  console.log("Creating second project with same code (should fail)...");
  const res2 = await createProject({
    ...commonContext,
    body: JSON.stringify(payload),
  } as any);
  console.log("Second response:", res2);
})();
