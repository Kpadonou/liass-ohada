import {
  adaptReceiptViewToInvoice,
  adaptPublicationToInvoice,
} from "@liass-ohada/shared/restaurants";
import { RestaurantReceiptService } from "./receipt-service";
import { TransactionScope } from "./transaction-model";

/** Canonical commercial facade. The underlying V1 publisher owns legacy proof bytes.
 * Transport handlers retain /receipt and its strict V1 response representation.
 */
export const RestaurantInvoiceService = {
  async read(
    scope: TransactionScope,
    actor: string,
    sessionId: string,
    input: unknown,
  ) {
    return adaptReceiptViewToInvoice(
      await RestaurantReceiptService.read(scope, actor, sessionId, input),
    );
  },
  async publish(
    scope: TransactionScope,
    actor: string,
    sessionId: string,
    input: unknown,
  ) {
    return adaptPublicationToInvoice(
      await RestaurantReceiptService.publish(scope, actor, sessionId, input),
    );
  },
  fromVerifiedView: adaptReceiptViewToInvoice,
  fromPublication: adaptPublicationToInvoice,
};
