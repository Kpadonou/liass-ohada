const DEFAULT_INVITATION_VALIDITY_DAYS = 7;

function invitationValidityDays(): number {
  const configured = Number(process.env.CABINET_INVITATION_VALIDITY_DAYS);
  return Number.isInteger(configured) && configured > 0 && configured <= 30
    ? configured
    : DEFAULT_INVITATION_VALIDITY_DAYS;
}

export const CabinetTeamConfig = {
  invitationValidityMs: () =>
    invitationValidityDays() * 24 * 60 * 60 * 1000,
  exposeInvitationToken: () =>
    process.env.NODE_ENV !== "production" &&
    process.env.CABINET_INVITATION_EXPOSE_TOKEN === "true",
};
