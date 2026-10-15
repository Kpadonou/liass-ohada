import { invitationValidityMs } from "./invitation-config";

export const CabinetTeamConfig = {
  invitationValidityMs: () =>
    invitationValidityMs(process.env.CABINET_INVITATION_VALIDITY_DAYS),
  exposeInvitationToken: () =>
    process.env.NODE_ENV !== "production" &&
    process.env.CABINET_INVITATION_EXPOSE_TOKEN === "true",
};
