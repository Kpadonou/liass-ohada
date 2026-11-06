/** Source authority is backend-private even when it travels with internal aggregates. */
export function publicSalesResponse<T>(value: T): T {
  if (Array.isArray(value)) return value.map(publicSalesResponse) as T;
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(
          ([k]) =>
            ![
              "calculationBinding",
              "issuanceAuthoritySnapshot",
              "issuanceAuthorityDigest",
            ].includes(k),
        )
        .map(([k, v]) => [k, publicSalesResponse(v)]),
    ) as T;
  return value;
}
