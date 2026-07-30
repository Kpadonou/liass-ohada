import type {
  ApplicationLanguage,
  OnboardingAccountingFramework,
  WorkspaceCountry
} from '@liass-ohada/shared/shared';

export interface IdentitySelectOption<T extends string> {
  value: T;
  labelKey: string;
}

const countryTranslationCodes: Record<WorkspaceCountry, string> = {
  BJ: 'BENIN',
  BF: 'BURKINA_FASO',
  CD: 'DEMOCRATIC_REPUBLIC_OF_CONGO',
  CF: 'CENTRAL_AFRICAN_REPUBLIC',
  CG: 'CONGO',
  CI: 'COTE_D_IVOIRE',
  CM: 'CAMEROON',
  GA: 'GABON',
  GN: 'GUINEA',
  GQ: 'EQUATORIAL_GUINEA',
  GW: 'GUINEA_BISSAU',
  KM: 'COMOROS',
  ML: 'MALI',
  NE: 'NIGER',
  SN: 'SENEGAL',
  TD: 'CHAD',
  TG: 'TOGO'
};

export const ohadaCountryOptions: readonly IdentitySelectOption<WorkspaceCountry>[] =
  Object.entries(countryTranslationCodes).map(([value, translationCode]) => ({
    value: value as WorkspaceCountry,
    labelKey: `IDENTITY.ONBOARDING.COUNTRIES.${translationCode}`
  }));

export const accountingFrameworkOptions: readonly IdentitySelectOption<OnboardingAccountingFramework>[] =
  [
    {
      value: 'SYSCOHADA_REVISED',
      labelKey: 'IDENTITY.ONBOARDING.FRAMEWORKS.SYSCOHADA_REVISED'
    },
    {
      value: 'SYCEBNL',
      labelKey: 'IDENTITY.ONBOARDING.FRAMEWORKS.SYCEBNL'
    }
  ];

export const applicationLanguageOptions: readonly IdentitySelectOption<ApplicationLanguage>[] = [
  { value: 'fr', labelKey: 'IDENTITY.CABINET_SETTINGS.LANGUAGES.FR' },
  { value: 'en', labelKey: 'IDENTITY.CABINET_SETTINGS.LANGUAGES.EN' }
];

export function countryTranslationKey(country: WorkspaceCountry): string {
  return `IDENTITY.ONBOARDING.COUNTRIES.${countryTranslationCodes[country]}`;
}
