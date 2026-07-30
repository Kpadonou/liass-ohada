import { HttpErrorResponse } from '@angular/common/http';
import type {
  CabinetSettings,
  OnboardingAccountingFramework,
  UpdateCabinetSettingsRequest,
  WorkspaceCountry
} from '@liass-ohada/shared/shared';

export interface CabinetSettingsFormValue {
  organizationName: string;
  country: WorkspaceCountry;
  contact: {
    email: string;
    phone: string;
    website: string;
  };
  address: {
    line1: string;
    line2: string;
    city: string;
    region: string;
    postalCode: string;
  };
  preferredLanguage: 'fr' | 'en';
  defaults: {
    country: WorkspaceCountry | null;
    accountingFramework: OnboardingAccountingFramework | null;
  };
}

export function cabinetSettingsFormValue(settings: CabinetSettings): CabinetSettingsFormValue {
  return {
    organizationName: settings.organizationName,
    country: settings.country,
    contact: {
      email: settings.contact.email ?? '',
      phone: settings.contact.phone ?? '',
      website: settings.contact.website ?? ''
    },
    address: {
      line1: settings.address.line1 ?? '',
      line2: settings.address.line2 ?? '',
      city: settings.address.city ?? '',
      region: settings.address.region ?? '',
      postalCode: settings.address.postalCode ?? ''
    },
    preferredLanguage: settings.preferredLanguage,
    defaults: {
      country: settings.defaults.country ?? null,
      accountingFramework: settings.defaults.accountingFramework ?? null
    }
  };
}

export function buildCabinetSettingsUpdate(
  settings: CabinetSettings,
  draft: CabinetSettingsFormValue
): UpdateCabinetSettingsRequest | null {
  const current = normalizeFormValue(draft);
  const original = normalizeFormValue(cabinetSettingsFormValue(settings));
  const request: UpdateCabinetSettingsRequest = { expectedVersion: settings.version };

  if (current.organizationName !== original.organizationName) {
    request.organizationName = current.organizationName;
  }
  if (current.country !== original.country) {
    request.country = current.country;
  }

  const contact = changedFields(original.contact, current.contact);
  if (Object.keys(contact).length > 0) {
    request.contact = contact;
  }

  const address = changedFields(original.address, current.address);
  if (Object.keys(address).length > 0) {
    request.address = address;
  }

  if (current.preferredLanguage !== original.preferredLanguage) {
    request.preferredLanguage = current.preferredLanguage;
  }

  const defaults: NonNullable<UpdateCabinetSettingsRequest['defaults']> = {};
  if (
    current.defaults.country !== null &&
    current.defaults.country !== original.defaults.country
  ) {
    defaults.country = current.defaults.country;
  }
  if (
    current.defaults.accountingFramework !== null &&
    current.defaults.accountingFramework !== original.defaults.accountingFramework
  ) {
    defaults.accountingFramework = current.defaults.accountingFramework;
  }
  if (Object.keys(defaults).length > 0) {
    request.defaults = defaults;
  }

  return Object.keys(request).length === 1 ? null : request;
}

export function cabinetSettingsErrorCode(error: unknown): string | null {
  if (!(error instanceof HttpErrorResponse)) {
    return null;
  }

  const payload = error.error;
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const message = (payload as { message?: unknown }).message;
  if (message && typeof message === 'object') {
    const code = (message as { code?: unknown }).code;
    return typeof code === 'string' ? code : null;
  }

  const nestedError = (payload as { error?: unknown }).error;
  if (nestedError && typeof nestedError === 'object') {
    const code = (nestedError as { code?: unknown }).code;
    return typeof code === 'string' ? code : null;
  }

  return null;
}

function normalizeFormValue(value: CabinetSettingsFormValue): CabinetSettingsFormValue {
  return {
    ...value,
    organizationName: value.organizationName.trim(),
    contact: mapTrimmed(value.contact),
    address: mapTrimmed(value.address)
  };
}

function mapTrimmed<T extends Record<string, string>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, entry.trim()])
  ) as T;
}

function changedFields<T extends Record<string, string>>(original: T, current: T): Partial<T> {
  const changes: Partial<T> = {};
  for (const key of Object.keys(current) as (keyof T)[]) {
    if (current[key] !== original[key]) {
      changes[key] = current[key];
    }
  }
  return changes;
}
