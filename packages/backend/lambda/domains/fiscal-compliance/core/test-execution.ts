/** Deployment-controlled gate. Never infer permission from NODE_ENV or provider data. */
export function realFiscalTestEnabled() {
  return process.env.FISCAL_REAL_TEST_ENABLED === "1" &&
    process.env.FISCAL_EXECUTION_MODE === "REAL_TEST" &&
    ["dev", "test"].includes(process.env.STAGE ?? "");
}

/** A one-way, capture-only recovery gate. It intentionally cannot enable the
 * provider CREATE/CONFIRM entrypoints. */
export function fiscalAdjudicationEnabled() {
  return process.env.FISCAL_ADJUDICATION_ENABLED === "1" &&
    process.env.FISCAL_REAL_TEST_ENABLED !== "1" &&
    process.env.FISCAL_EXECUTION_MODE === "REAL_TEST" &&
    ["dev", "test"].includes(process.env.STAGE ?? "");
}
