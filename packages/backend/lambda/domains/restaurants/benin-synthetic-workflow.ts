import { SyntheticFiscalOrchestrator } from "../fiscal-compliance/core/synthetic-fiscal-orchestrator";
import { FiscalAttemptStore } from "../fiscal-compliance/persistence/fiscal-attempt-store";
import { BeninEMecefTestAdapter } from "../fiscal-compliance/providers/benin-emecef/benin-emecef-test-adapter";
import { DurableBeninBinding } from "../fiscal-compliance/providers/benin-emecef/durable-benin-binding";
import { restaurantBeninPreparation } from "./benin-fiscal-request-mapper";

/** Local synthetic composition only. Authorization remains an explicit trusted
 * application dependency; no HTTP handler, credential storage or auto-dispatch.
 */
export function restaurantBeninSyntheticWorkflow(input: {
  outletId: string;
  sessionId: string;
  classifications: unknown;
  mapping: unknown;
  adapter: BeninEMecefTestAdapter;
  credential: () => string;
  authorize: ConstructorParameters<typeof SyntheticFiscalOrchestrator>[2];
}) {
  if (process.env.NODE_ENV !== "test")
    throw new Error("FISCAL_WORKFLOW_DISABLED");
  return new SyntheticFiscalOrchestrator(
    new FiscalAttemptStore(),
    new DurableBeninBinding(input.adapter, input.credential),
    input.authorize,
    restaurantBeninPreparation(
      input.outletId,
      input.sessionId,
      input.classifications,
      input.mapping,
    ),
  );
}
