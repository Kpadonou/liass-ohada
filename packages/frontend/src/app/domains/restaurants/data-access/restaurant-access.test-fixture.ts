import type { WorkspaceSummary, RestaurantsRole } from '@liass-ohada/shared/shared';
/** Synthetic memberships mirroring invitation acceptance and provisioning; no personal data. */
export const accessWorkspace = (role?: RestaurantsRole, orgId = 'org-a'): WorkspaceSummary => ({
  orgId,
  displayName: orgId === 'org-a' ? 'Atelier Resto' : 'Autre espace',
  workspaceType: 'COMPANY',
  accessSource: 'DIRECT',
  status: 'ACTIVE',
  role: 'MEMBER',
  ...(role ? { productRoles: { RESTAURANTS: role } } : {}),
});
