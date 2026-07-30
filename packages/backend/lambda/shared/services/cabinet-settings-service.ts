import {
  CabinetAddress,
  CabinetContact,
  CabinetSettings,
  CabinetSettingsSchema,
  OnboardingAccountingFrameworkSchema,
  UpdateCabinetSettingsRequest,
  UpdateCabinetSettingsRequestSchema,
  WorkspaceCountrySchema,
} from "@liass-ohada/shared/shared";
import { AppError } from "../app-error";
import {
  CabinetOrganizationRecord,
  CabinetSettingsConflictError,
  CabinetSettingsDataError,
  CabinetSettingsItem,
  CabinetSettingsRepository,
} from "../repositories/cabinet-settings-repository";
import {
  CabinetAuthorizationService,
  CabinetRequestContext,
} from "./cabinet-authorization-service";

const DEFAULT_LANGUAGE = "fr" as const;

const mergeOptionalFields = <T extends Record<string, unknown>>(
  current: T,
  changes: Partial<T> | undefined,
): T => {
  if (!changes) return current;
  const merged = { ...current };
  for (const [key, value] of Object.entries(changes)) {
    if (value === undefined) {
      delete merged[key];
    } else {
      (merged as Record<string, unknown>)[key] = value;
    }
  }
  return merged;
};

const settingsState = (item: CabinetSettingsItem | undefined) => ({
  contact: item?.contact ?? {},
  address: item?.address ?? {},
  preferredLanguage: item?.preferredLanguage ?? DEFAULT_LANGUAGE,
  defaults: {
    country: item?.defaultClientCountry,
    accountingFramework: item?.defaultAccountingFramework,
  },
});

const composedSettings = (
  organization: CabinetOrganizationRecord,
  item?: CabinetSettingsItem,
): CabinetSettings => {
  const country = WorkspaceCountrySchema.safeParse(organization.country);
  if (
    organization.workspaceType !== "ACCOUNTING_FIRM" ||
    organization.status !== "ACTIVE" ||
    !country.success
  ) {
    throw new AppError(409, "CABINET_SETTINGS_DATA_INCONSISTENT");
  }
  const state = settingsState(item);
  const organizationFramework = OnboardingAccountingFrameworkSchema.safeParse(
    organization.accountingFramework,
  );
  return CabinetSettingsSchema.parse({
    cabinetOrgId: organization.orgId,
    organizationName: organization.name,
    country: country.data,
    contact: state.contact,
    address: state.address,
    preferredLanguage: state.preferredLanguage,
    defaults: {
      country: state.defaults.country ?? country.data,
      accountingFramework:
        state.defaults.accountingFramework ??
        (organizationFramework.success ? organizationFramework.data : undefined),
    },
    version: item?.version ?? 0,
    createdAt: item?.createdAt,
    updatedAt: item?.updatedAt,
  });
};

const audit = (input: {
  actorUserId: string;
  cabinetOrgId: string;
  changedFields: string[];
  previousVersion: number;
  newVersion: number;
  timestamp: string;
}) => {
  console.info("[CABINET_SETTINGS_AUDIT]", {
    action: input.previousVersion === 0 ? "CREATED" : "UPDATED",
    ...input,
  });
};

export class CabinetSettingsService {
  private static async authorizedState(context: CabinetRequestContext) {
    const authorized = await CabinetAuthorizationService.requireAdmin(context);
    let organization: CabinetOrganizationRecord | undefined;
    let settings: CabinetSettingsItem | undefined;
    try {
      [organization, settings] = await Promise.all([
        CabinetSettingsRepository.getOrganization(authorized.cabinetOrgId),
        CabinetSettingsRepository.getCabinetSettings(authorized.cabinetOrgId),
      ]);
    } catch (error) {
      if (error instanceof CabinetSettingsDataError) {
        throw new AppError(409, "CABINET_SETTINGS_DATA_INCONSISTENT");
      }
      throw error;
    }
    if (!organization) {
      throw new AppError(404, "CABINET_SETTINGS_ORGANIZATION_NOT_FOUND");
    }
    if (
      organization.workspaceType !== "ACCOUNTING_FIRM" ||
      organization.status !== "ACTIVE"
    ) {
      throw new AppError(409, "CABINET_SETTINGS_DATA_INCONSISTENT");
    }
    return { authorized, organization, settings };
  }

  static async getSettings(
    context: CabinetRequestContext,
  ): Promise<CabinetSettings> {
    const { organization, settings } = await this.authorizedState(context);
    return composedSettings(organization, settings);
  }

  static async updateSettings(
    context: CabinetRequestContext,
    data: UpdateCabinetSettingsRequest,
  ): Promise<CabinetSettings> {
    const request = UpdateCabinetSettingsRequestSchema.parse(data);
    const { authorized, organization, settings } =
      await this.authorizedState(context);
    const currentVersion = settings?.version ?? 0;
    if (request.expectedVersion !== currentVersion) {
      throw new AppError(409, "CABINET_SETTINGS_UPDATE_CONFLICT");
    }

    const current = settingsState(settings);
    const contact = mergeOptionalFields<CabinetContact>(
      current.contact,
      request.contact,
    );
    const address = mergeOptionalFields<CabinetAddress>(
      current.address,
      request.address,
    );
    const defaults = mergeOptionalFields(current.defaults, request.defaults);
    const organizationName = request.organizationName ?? organization.name;
    const organizationCountry = request.country ?? organization.country;
    const preferredLanguage =
      request.preferredLanguage ?? current.preferredLanguage;

    const changedFields = [
      ...(organizationName !== organization.name ? ["organizationName"] : []),
      ...(organizationCountry !== organization.country ? ["country"] : []),
      ...(JSON.stringify(contact) !== JSON.stringify(current.contact)
        ? ["contact"]
        : []),
      ...(JSON.stringify(address) !== JSON.stringify(current.address)
        ? ["address"]
        : []),
      ...(preferredLanguage !== current.preferredLanguage
        ? ["preferredLanguage"]
        : []),
      ...(defaults.country !== current.defaults.country
        ? ["defaults.country"]
        : []),
      ...(defaults.accountingFramework !== current.defaults.accountingFramework
        ? ["defaults.accountingFramework"]
        : []),
    ];
    if (changedFields.length === 0) {
      return composedSettings(organization, settings);
    }

    const now = new Date().toISOString();
    const nextVersion = currentVersion + 1;
    const parsedCountry = WorkspaceCountrySchema.safeParse(organizationCountry);
    const parsedFramework = OnboardingAccountingFrameworkSchema.safeParse(
      organization.accountingFramework,
    );
    if (!parsedCountry.success) {
      throw new AppError(409, "CABINET_SETTINGS_DATA_INCONSISTENT");
    }
    const initialized = CabinetSettingsRepository.buildInitialItem({
      cabinetOrgId: authorized.cabinetOrgId,
      country: parsedCountry.data,
      accountingFramework: parsedFramework.success
        ? parsedFramework.data
        : undefined,
      actorUserId: context.userId,
      now,
    });
    const nextSettings: CabinetSettingsItem = {
      ...initialized,
      contact,
      address,
      preferredLanguage,
      defaultClientCountry: defaults.country,
      defaultAccountingFramework: defaults.accountingFramework,
      version: nextVersion,
      createdAt: settings?.createdAt ?? now,
      createdBy: settings?.createdBy ?? context.userId,
      updatedAt: now,
      updatedBy: context.userId,
    };

    try {
      await CabinetSettingsRepository.transactUpdate({
        organization,
        organizationChanges:
          organizationName !== organization.name ||
          organizationCountry !== organization.country
            ? {
                ...(organizationName !== organization.name && {
                  name: organizationName,
                }),
                ...(organizationCountry !== organization.country && {
                  country: organizationCountry,
                }),
              }
            : undefined,
        settings: nextSettings,
        expectedVersion: currentVersion,
      });
    } catch (error) {
      if (error instanceof CabinetSettingsConflictError) {
        throw new AppError(409, "CABINET_SETTINGS_UPDATE_CONFLICT");
      }
      throw error;
    }

    audit({
      actorUserId: context.userId,
      cabinetOrgId: authorized.cabinetOrgId,
      changedFields,
      previousVersion: currentVersion,
      newVersion: nextVersion,
      timestamp: now,
    });
    return composedSettings(
      {
        ...organization,
        name: organizationName,
        country: organizationCountry,
        updatedAt: now,
      },
      nextSettings,
    );
  }
}
