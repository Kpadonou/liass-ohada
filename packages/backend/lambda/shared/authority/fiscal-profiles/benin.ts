/** Platform-governed definitions. A declaration carries only the country and regime IDs. */
export const BENIN_FISCAL_REGIMES = Object.freeze({
  ORDINARY_VAT: Object.freeze({
    id: "ORDINARY_VAT",
    version: 1,
    taxRateBasisPoints: 1800,
    basis: "NET_SALE",
  }),
  RESTAURANT_VAT_ON_MARGIN: Object.freeze({
    id: "RESTAURANT_VAT_ON_MARGIN",
    version: 1,
    taxRateBasisPoints: 1800,
    marginBasisPoints: 3310,
    basis: "PERIOD_NET_SALES",
    reference: "BJ-ARRETE-658-C-2024-03-25",
  }),
} as const);
