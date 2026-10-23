import { isGuestEntryPath } from './app/core/routing/guest-entry';
// Direct Guest entry must not evaluate Cognito, workspace or back-office modules.
const bootstrap = isGuestEntryPath(window.location.pathname)
  ? import('./app/guest.bootstrap').then((m) => m.bootstrapGuest())
  : import('./app/staff.bootstrap').then((m) => m.bootstrapStaff());
bootstrap.catch((error) => console.error(error));
