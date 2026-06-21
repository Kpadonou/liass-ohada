import {
  AuxiliaryTypeValue,
  type Account,
} from "@liass-ohada/shared/accounting";
import { AppError } from "./app-error";

export interface AccountAuxiliaryMetadata {
  requiresThirdParty: boolean;
  auxiliaryType: AuxiliaryTypeValue;
}

export function defaultAuxiliaryMetadata(
  accountId: string,
  isThirdPartyAccount = false,
): AccountAuxiliaryMetadata {
  if (accountId.startsWith("411")) {
    return { requiresThirdParty: true, auxiliaryType: "CUSTOMER" };
  }
  if (accountId.startsWith("401")) {
    return { requiresThirdParty: true, auxiliaryType: "SUPPLIER" };
  }
  if (isThirdPartyAccount) {
    return { requiresThirdParty: true, auxiliaryType: "THIRD_PARTY" };
  }
  return { requiresThirdParty: false, auxiliaryType: "NONE" };
}

export function resolveAuxiliaryMetadata(
  account: Pick<
    Account,
    "accountId" | "isThirdPartyAccount" | "requiresThirdParty" | "auxiliaryType"
  >,
): AccountAuxiliaryMetadata {
  if (
    account.requiresThirdParty === undefined &&
    account.auxiliaryType === undefined
  ) {
    return defaultAuxiliaryMetadata(
      account.accountId,
      account.isThirdPartyAccount,
    );
  }

  if (
    account.requiresThirdParty === undefined ||
    account.auxiliaryType === undefined
  ) {
    throw new AppError(400, "ACCOUNT_AUXILIARY_CONFIGURATION_INVALID");
  }

  const isAuxiliary = account.auxiliaryType !== "NONE";
  if (
    account.requiresThirdParty !== isAuxiliary ||
    account.isThirdPartyAccount !== isAuxiliary
  ) {
    throw new AppError(400, "ACCOUNT_AUXILIARY_CONFIGURATION_INVALID");
  }

  return {
    requiresThirdParty: account.requiresThirdParty,
    auxiliaryType: account.auxiliaryType,
  };
}
