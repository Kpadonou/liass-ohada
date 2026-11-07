/** Official environment distinction. PRODUCTION mapping is not authorization to dispatch. */
export const BENIN_EMECEF_BASE_URLS = Object.freeze({
  TEST: "https://developper.impots.bj/sygmef-emcf",
  PRODUCTION: "https://sygmef.impots.bj/emcf",
});
export function beninStatusEndpoint(environment: "TEST" | "PRODUCTION") {
  if (environment !== "TEST" && environment !== "PRODUCTION")
    throw new Error("ENVIRONMENT_NOT_ALLOWED");
  return `${BENIN_EMECEF_BASE_URLS[environment]}/api/info/status`;
}
