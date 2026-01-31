import { handler } from "../lambda/domains/core-ledger/accounts/get-entries";

const mockEvent: any = {
  pathParameters: {
    orgId: "test-org-001",
    fiscalYear: "2026",
    accountNumber: "52100000",
  },
  queryStringParameters: { limit: "10" },
  headers: { "Accept-Language": "fr" },
};

handler(mockEvent).then((response) => {
  console.log("📖 Détail du Grand Livre :");
  console.log(JSON.stringify(JSON.parse(response.body), null, 2));
});
