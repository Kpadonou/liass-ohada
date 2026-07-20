import type { CabinetRole } from "@liass-ohada/shared";

const CABINET_ROLES: readonly CabinetRole[] = [
  "CABINET_ADMIN",
  "SUPERVISOR",
  "COLLABORATOR",
  "READER",
];

/**
 * Keeps Cabinet workspaces created before cabinetRole was persisted usable.
 * Only the original workspace owner receives the legacy administrator mapping.
 */
export function resolveCabinetRole(input: {
  cabinetRole?: unknown;
  role?: unknown;
  workspaceType?: unknown;
}): CabinetRole | undefined {
  if (
    typeof input.cabinetRole === "string" &&
    CABINET_ROLES.includes(input.cabinetRole as CabinetRole)
  ) {
    return input.cabinetRole as CabinetRole;
  }

  return input.workspaceType === "ACCOUNTING_FIRM" && input.role === "OWNER"
    ? "CABINET_ADMIN"
    : undefined;
}
