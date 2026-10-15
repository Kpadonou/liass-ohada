import { restaurantTransactionHandler } from "./transaction-handler";
export const handler = restaurantTransactionHandler(
  "replace-responsible-staff",
);
