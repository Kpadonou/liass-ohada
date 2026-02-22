import { handler as dashboardHandler } from "../lambda/domains/projects/list-projects-summary";
import { APIGatewayProxyEvent } from "aws-lambda";

async function runFinalTest() {
  console.log("\n🚀 TEST DU DASHBOARD GLOBAL (VUE SAAS)");
  console.log("===============================================");

  const event = {
    headers: { "Accept-Language": "fr" },
    requestContext: { authorizer: { claims: { orgId: "org-test-dash" } } },
    queryStringParameters: { year: "2026" },
  } as unknown as APIGatewayProxyEvent;

  const result = await dashboardHandler(event);
  const { data } = JSON.parse(result.body);

  console.table(
    data.map((p: any) => ({
      Code: p.projectInfo.code,
      Nom: p.projectInfo.name,
      "Position Cash": `${p.financials.netPosition} XOF`,
      "Exéc. Annuelle": `${p.financials.annualExecutionRate.toFixed(2)}%`,
      "Alerte Cash": p.alerts.isCashNegative ? "🔴 DÉFICIT" : "🟢 OK",
    })),
  );
}

runFinalTest().catch(console.error);
