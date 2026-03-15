import { handler } from "../lambda/domains/projects/get-project-report";
import { APIGatewayProxyEvent } from "aws-lambda";

async function runMultiDonorReportTest() {
  const projectId = "EDU-002"; // Assure-toi que ce projet existe dans ton LocalStack
  const orgId = "org-test-dash";

  console.log(`\n🚀 MULTI-DONOR REPORT TEST - Project: ${projectId}`);
  console.log("===========================================================");

  const event = {
    pathParameters: { projectId },
    queryStringParameters: { year: "2026" },
    headers: { "Accept-Language": "fr" },
    requestContext: {
      authorizer: { claims: { orgId: orgId } },
    },
  } as unknown as APIGatewayProxyEvent;

  const result = await handler(event);
  const response = JSON.parse(result.body);

  if (!response.success) {
    console.error("❌ HANDLER ERROR");
    console.dir(response, { depth: null });
    return;
  }

  const data = response.data;

  // 1. Header Information
  console.log(
    `\n🏢 PROJECT    : ${data.projectInfo.name} (${data.projectInfo.code})`,
  );
  console.log(`📅 REPORT YEAR: ${data.metadata.reportYear}`);
  console.log(
    `👥 DONORS     : ${data.projectInfo.donorList.map((d: any) => d.label).join(", ")}`,
  );
  console.log(`-----------------------------------------------------------`);

  // 2. Financial Summary
  console.log("\n💰 FINANCIAL POSITION (Annual) :");
  console.table({
    "Total Resources": `${data.financialPosition.totalResources.toLocaleString()} XOF`,
    "Total Expenses": `${data.financialPosition.totalExpenses.toLocaleString()} XOF`,
    "Net Cash Position": `${data.financialPosition.netCash.toLocaleString()} XOF`,
  });

  // 3. Multi-Donor Analytical Matrix
  if (data.budgetVsActual && data.budgetVsActual.length > 0) {
    console.log("\n📈 BUDGETARY ANALYSIS (Multi-Donor Pivot) :");

    const matrixTable = data.budgetVsActual.map((b: any) => {
      // We dynamically create columns for each donor found in the breakdown
      const donorBreakdown: any = {};
      data.projectInfo.donorList.forEach((donor: any) => {
        donorBreakdown[donor.label] = (
          b.donors[donor.id] || 0
        ).toLocaleString();
      });

      return {
        Code: b.code,
        Label: b.label,
        Budget: b.allocated.toLocaleString(),
        ...donorBreakdown, // Dynamic donor columns
        Unallocated: b.unallocated.toLocaleString(),
        Total_Spent: b.spent.toLocaleString(),
        "%_Exec": b.executionRate.toFixed(2) + "%",
      };
    });
    console.table(matrixTable);
  }

  // 4. OHADA General Ledger View
  console.log("\n🔍 GENERAL LEDGER VIEW (OHADA) :");
  const accountTable = data.accountDetails.map((d: any) => ({
    Account: d.accountId,
    Debit: d.debit.toLocaleString(),
    Credit: d.credit.toLocaleString(),
    Balance: d.formattedBalance,
  }));
  console.table(accountTable);
}

runMultiDonorReportTest().catch(console.error);
