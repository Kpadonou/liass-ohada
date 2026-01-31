// test-local.ts
import { handler } from "../lambda/domains/core-ledger/entries/post-entry";

const mockEvent = {
  body: JSON.stringify({
    year: 2024,
    lines: [
      { accountId: "52100000", debit: 1000, credit: 0 },
      { accountId: "40110000", debit: 0, credit: 500 }, // Déséquilibré
    ],
  }),
  requestContext: {
    authorizer: { claims: { orgId: "test-org-001", userId: "user-123" } },
  },
  headers: {},
} as any;

handler(mockEvent).then((res) => {
  console.log("RÉSULTAT DU TEST LOCAL :");
  console.log(res.statusCode);
  console.log(res.body);
});
