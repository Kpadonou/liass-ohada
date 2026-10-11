/** No fallback to Platform storage: missing/ambiguous binding fails closed. */
export function restaurantsTableName(): string {
  const table = process.env.RESTAURANTS_TABLE_NAME?.trim();
  const platform = process.env.PLATFORM_TABLE_NAME || process.env.TABLE_NAME;
  if (!table || table === platform)
    throw new Error(
      "RESTAURANTS_TABLE_NAME must identify a dedicated business table",
    );
  return table;
}
