/** Deployment-controlled gate. Never infer permission from NODE_ENV or provider data. */
export function realFiscalTestEnabled() {
  return process.env.FISCAL_REAL_TEST_ENABLED === "1" &&
    process.env.FISCAL_EXECUTION_MODE === "REAL_TEST" &&
    ["dev", "test"].includes(process.env.STAGE ?? "");
}
