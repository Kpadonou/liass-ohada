import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { CabinetSettings } from '@liass-ohada/shared/shared';
import { TranslocoService, TranslocoTestingModule } from '@ngneat/transloco';
import { provideTanStackQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { vi } from 'vitest';

import { NotificationService } from '../../../../core/notifications/notification.service';
import { PendingChangesService } from '../../../../core/routing/pending-changes.service';
import { AuthStore } from '../../data-access/auth.store';
import { CabinetDashboardQueries } from '../../data-access/cabinet-dashboard.queries';
import { CabinetSettingsApi } from '../../data-access/cabinet-settings.api';
import { CabinetSettingsPage } from './cabinet-settings.page';

const settings: CabinetSettings = {
  cabinetOrgId: 'org-cabinet',
  organizationName: 'Cabinet Kora',
  country: 'BJ',
  contact: { email: 'contact@kora.test' },
  address: { city: 'Cotonou' },
  preferredLanguage: 'fr',
  defaults: { country: 'SN', accountingFramework: 'SYSCOHADA_REVISED' },
  version: 0
};

const translations = {
  en: {
    COMMON: { SELECT: { NO_RESULTS: 'No results', SEARCH_PLACEHOLDER: 'Search' } },
    IDENTITY: {
      ONBOARDING: {
        COUNTRIES: {
          BENIN: 'Benin',
          SENEGAL: 'Senegal',
          COTE_D_IVOIRE: "Côte d'Ivoire"
        },
        FRAMEWORKS: {
          SYSCOHADA_REVISED: 'Revised SYSCOHADA',
          SYCEBNL: 'SYCEBNL — Accounting system for nonprofit entities'
        }
      },
      CABINET_SETTINGS: {
        ACTIONS: {
          DISCARD: 'Discard changes',
          RELOAD: 'Reload latest settings',
          RETRY: 'Retry',
          SAVE: 'Save changes'
        },
        CONFLICT: {
          DESCRIPTION: 'Reload the latest version.',
          KEEP_DRAFT: 'Keep reviewing my changes',
          RELOAD_DESCRIPTION: 'Your changes will be lost.',
          RELOAD_TITLE: 'Reload settings?',
          TITLE: 'The settings were changed.'
        },
        ERRORS: { GENERIC: 'Unable to save.' },
        EYEBROW: 'Cabinet',
        FIELDS: {
          ADDRESS_LINE_1: 'Address',
          ADDRESS_LINE_2: 'Address line 2',
          CITY: 'City',
          COUNTRY: 'Cabinet country',
          DEFAULT_COUNTRY: 'Default country',
          DEFAULT_FRAMEWORK: 'Default framework',
          EMAIL: 'Professional email',
          ORGANIZATION_NAME: 'Cabinet name',
          PHONE: 'Phone',
          POSTAL_CODE: 'Postal code',
          PREFERRED_LANGUAGE: 'Preferred Cabinet language',
          REGION: 'Region',
          WEBSITE: 'Website'
        },
        HELP: {
          COUNTRY: 'Existing dossiers stay unchanged.',
          DEFAULT_FRAMEWORK: 'Suggested for new dossiers.',
          DEFAULTS_BANNER: 'Future dossiers only.',
          EMAIL: 'Separate professional address.',
          ORGANIZATION_NAME: 'Used in the shell.',
          PREFERRED_LANGUAGE: 'Does not change personal language.'
        },
        LANGUAGES: { EN: 'English', FR: 'Français' },
        LOADING: 'Loading settings',
        LOAD_ERROR: { DESCRIPTION: 'Try again.', TITLE: 'Unable to load settings.' },
        NOTIFICATIONS: { SAVED: 'Cabinet settings saved.' },
        SECTIONS: {
          ADDRESS: { DESCRIPTION: 'Address details', TITLE: 'Address' },
          CONTACT: { DESCRIPTION: 'Contact details', TITLE: 'Professional contact details' },
          DEFAULTS: { DESCRIPTION: 'Future defaults', TITLE: 'Default values for new dossiers' },
          GENERAL: { DESCRIPTION: 'Canonical profile', TITLE: 'General information' },
          LANGUAGE: { DESCRIPTION: 'Cabinet preference', TITLE: 'Cabinet language' }
        },
        SUBTITLE: 'Manage Cabinet settings.',
        TITLE: 'Cabinet settings',
        VALIDATION: {
          ADDRESS: 'Invalid address',
          COUNTRY: 'Invalid country',
          EMAIL: 'Invalid email',
          LANGUAGE: 'Invalid language',
          ORGANIZATION_NAME: 'Invalid Cabinet name',
          PHONE: 'Invalid phone',
          WEBSITE: 'Invalid website'
        }
      }
    }
  }
};

interface TestPage {
  authoritative(): CabinetSettings | null;
  conflict(): boolean;
  form: CabinetSettingsPage['form'];
  save(): Promise<void>;
}

describe('CabinetSettingsPage', () => {
  let fixture: ComponentFixture<CabinetSettingsPage>;
  let getCabinetSettings: ReturnType<typeof vi.fn>;
  let updateCabinetSettings: ReturnType<typeof vi.fn>;
  let notifications: { error: ReturnType<typeof vi.fn>; success: ReturnType<typeof vi.fn> };
  let loadWorkspaces: ReturnType<typeof vi.fn>;
  let queryClient: QueryClient;

  beforeEach(async () => {
    getCabinetSettings = vi.fn().mockResolvedValue(settings);
    updateCabinetSettings = vi.fn().mockResolvedValue({
      ...settings,
      preferredLanguage: 'en',
      version: 1
    });
    notifications = { error: vi.fn(), success: vi.fn() };
    loadWorkspaces = vi.fn().mockResolvedValue([]);
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const activeWorkspace = signal({
      orgId: 'org-cabinet',
      workspaceType: 'ACCOUNTING_FIRM' as const,
      status: 'ACTIVE' as const,
      cabinetRole: 'CABINET_ADMIN' as const
    });

    await TestBed.configureTestingModule({
      imports: [
        CabinetSettingsPage,
        TranslocoTestingModule.forRoot({
          langs: translations,
          preloadLangs: true,
          translocoConfig: { availableLangs: ['en'], defaultLang: 'en' }
        })
      ],
      providers: [
        provideRouter([]),
        provideTanStackQuery(queryClient),
        {
          provide: CabinetSettingsApi,
          useValue: { getCabinetSettings, updateCabinetSettings }
        },
        {
          provide: AuthStore,
          useValue: {
            activeWorkspace,
            activeWorkspaceOrgId: () => 'org-cabinet',
            activeWorkspaceType: () => 'ACCOUNTING_FIRM',
            loadWorkspaces
          }
        },
        {
          provide: CabinetDashboardQueries,
          useValue: { all: () => ['cabinet-dashboard', 'org-cabinet'] }
        },
        { provide: NotificationService, useValue: notifications },
        {
          provide: PendingChangesService,
          useValue: { confirmDeparture: vi.fn().mockResolvedValue(true), setPendingChanges: vi.fn() }
        }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(CabinetSettingsPage);
    fixture.detectChanges();
    await vi.waitFor(() =>
      expect((fixture.componentInstance as unknown as TestPage).authoritative()).not.toBeNull()
    );
    fixture.detectChanges();
  });

  it('initializes version 0 as pristine and never writes during GET', () => {
    const page = fixture.componentInstance as unknown as TestPage;
    expect(page.form.getRawValue()).toMatchObject({
      organizationName: 'Cabinet Kora',
      country: 'BJ',
      contact: { email: 'contact@kora.test', phone: '', website: '' }
    });
    expect(page.form.pristine).toBe(true);
    expect(updateCabinetSettings).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).not.toContain('org-cabinet');
  });

  it('saves the authoritative version without changing the personal Transloco language', async () => {
    const page = fixture.componentInstance as unknown as TestPage;
    const transloco = TestBed.inject(TranslocoService);
    const setActiveLang = vi.spyOn(transloco, 'setActiveLang');
    page.form.controls.preferredLanguage.setValue('en');

    await page.save();

    expect(updateCabinetSettings).toHaveBeenCalledWith({
      expectedVersion: 0,
      preferredLanguage: 'en'
    });
    expect(setActiveLang).not.toHaveBeenCalled();
    expect(page.authoritative()?.version).toBe(1);
    expect(page.form.pristine).toBe(true);
    expect(notifications.success).toHaveBeenCalledWith('Cabinet settings saved.');
  });

  it('preserves the draft and blocks another save after a version conflict', async () => {
    updateCabinetSettings.mockRejectedValueOnce(
      new HttpErrorResponse({
        status: 409,
        error: {
          message: {
            code: 'CABINET_SETTINGS_UPDATE_CONFLICT',
            message: 'Conflict'
          }
        }
      })
    );
    const page = fixture.componentInstance as unknown as TestPage;
    page.form.controls.organizationName.setValue('Cabinet Kora Conseil');

    await page.save();

    expect(page.conflict()).toBe(true);
    expect(page.form.controls.organizationName.value).toBe('Cabinet Kora Conseil');
    await page.save();
    expect(updateCabinetSettings).toHaveBeenCalledTimes(1);
  });

  it('refreshes canonical workspace discovery and only the Cabinet Dashboard after a name change', async () => {
    updateCabinetSettings.mockResolvedValueOnce({
      ...settings,
      organizationName: 'Cabinet Kora Conseil',
      version: 1
    });
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const page = fixture.componentInstance as unknown as TestPage;
    page.form.controls.organizationName.setValue('Cabinet Kora Conseil');

    await page.save();

    expect(loadWorkspaces).toHaveBeenCalledWith(true);
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ['cabinet-dashboard', 'org-cabinet']
    });
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(
      queryClient.getQueryData(['cabinet-settings', 'org-cabinet', 'detail'])
    ).toMatchObject({ organizationName: 'Cabinet Kora Conseil', version: 1 });
  });
});
