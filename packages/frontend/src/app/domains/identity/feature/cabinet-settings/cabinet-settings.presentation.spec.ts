import type { CabinetSettings } from '@liass-ohada/shared/shared';

import {
  buildCabinetSettingsUpdate,
  cabinetSettingsFormValue
} from './cabinet-settings.presentation';

const settings: CabinetSettings = {
  cabinetOrgId: 'org-cabinet',
  organizationName: 'Cabinet Kora',
  country: 'BJ',
  contact: {
    email: 'contact@kora.test',
    phone: '+229 01 23',
    website: 'https://kora.test'
  },
  address: { line1: 'Rue 1', city: 'Cotonou' },
  preferredLanguage: 'fr',
  defaults: { country: 'SN', accountingFramework: 'SYSCOHADA_REVISED' },
  version: 0
};

describe('Cabinet Settings presentation', () => {
  it('initializes a legacy version-0 response without inventing optional values', () => {
    const value = cabinetSettingsFormValue({
      ...settings,
      contact: {},
      address: {},
      defaults: {}
    });

    expect(value.contact).toEqual({ email: '', phone: '', website: '' });
    expect(value.address).toEqual({ line1: '', line2: '', city: '', region: '', postalCode: '' });
    expect(value.defaults).toEqual({ country: null, accountingFramework: null });
    expect(buildCabinetSettingsUpdate(settings, cabinetSettingsFormValue(settings))).toBeNull();
  });

  it('builds a trimmed minimal nested PATCH and preserves sibling fields', () => {
    const draft = cabinetSettingsFormValue(settings);
    draft.contact.phone = '  +229 (01) 99-88  ';

    expect(buildCabinetSettingsUpdate(settings, draft)).toEqual({
      expectedVersion: 0,
      contact: { phone: '+229 (01) 99-88' }
    });
  });

  it('sends an intentional blank string to clear optional text without clearing siblings', () => {
    const draft = cabinetSettingsFormValue(settings);
    draft.contact.email = ' ';
    draft.address.city = '';

    expect(buildCabinetSettingsUpdate(settings, draft)).toEqual({
      expectedVersion: 0,
      contact: { email: '' },
      address: { city: '' }
    });
  });

  it('keeps Cabinet country and future-dossier defaults independent', () => {
    const cabinetCountryDraft = cabinetSettingsFormValue(settings);
    cabinetCountryDraft.country = 'CI';
    expect(buildCabinetSettingsUpdate(settings, cabinetCountryDraft)).toEqual({
      expectedVersion: 0,
      country: 'CI'
    });

    const defaultCountryDraft = cabinetSettingsFormValue(settings);
    defaultCountryDraft.defaults.country = 'CI';
    expect(buildCabinetSettingsUpdate(settings, defaultCountryDraft)).toEqual({
      expectedVersion: 0,
      defaults: { country: 'CI' }
    });
  });

  it('uses the authoritative loaded version and never increments it locally', () => {
    const draft = cabinetSettingsFormValue({ ...settings, version: 7 });
    draft.preferredLanguage = 'en';
    expect(buildCabinetSettingsUpdate({ ...settings, version: 7 }, draft)).toEqual({
      expectedVersion: 7,
      preferredLanguage: 'en'
    });
  });
});
