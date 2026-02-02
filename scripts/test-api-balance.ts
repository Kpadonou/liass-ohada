import { handler } from "../lambda/domains/core-ledger/accounts/get-balance";

const mockEvent: any = {
  pathParameters: {
    orgId: "test-org-001",
    fiscalYear: "2026",
    accountId: "52100000",
  },
  headers: { "Accept-Language": "fr" },
};

handler(mockEvent).then((response) => {
  console.log("🚀 Réponse de l'API :");
  console.log(JSON.stringify(JSON.parse(response.body), null, 2));
});
