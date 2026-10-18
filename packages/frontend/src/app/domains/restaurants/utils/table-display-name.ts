/** Operational identity; table codes remain available in configuration only. */
export function tableDisplayName(table: {
  name?: string | null;
  code?: string | null;
  tableName?: string | null;
  tableCode?: string | null;
}): string {
  return (
    table.name?.trim() ||
    table.tableName?.trim() ||
    table.code?.trim() ||
    table.tableCode?.trim() ||
    ''
  );
}
