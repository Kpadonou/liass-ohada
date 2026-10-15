/** Platform invitations share the established Cabinet default and bounded configuration. */
export function invitationValidityMs(configured?: string): number {
  const days = Number(configured);
  return (
    (Number.isInteger(days) && days > 0 && days <= 30 ? days : 7) *
    24 *
    60 *
    60 *
    1000
  );
}
