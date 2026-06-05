import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslocoTestingModule } from '@ngneat/transloco';

import { AppSidebarComponent } from './app-sidebar.component';

const translations = {
  fr: {
    SHELL: {
      AI_PANEL: {
        EYEBROW: 'IA native',
        TEXT: 'Les suggestions comptables restent limitées.'
      },
      BRAND_TAGLINE: 'Poste ERP',
      LOGO_ALT: 'logo liass-ohada',
      NAV: {
        ACCOUNTING: 'Comptabilité',
        ADMINISTRATION: 'Administration',
        CHART_OF_ACCOUNTS: 'Plan comptable',
        DASHBOARD: 'Tableau de bord',
        ENTRIES: 'Écritures',
        GENERAL_LEDGER: 'Grand livre',
        JOURNALS: 'Journaux',
        PROJECTS: 'Projets et fonds',
        REPORTS: 'États OHADA',
        SECTION_LABEL: 'Espace',
        SYCEBNL_BADGE: 'SYCEBNL',
        TREASURY: 'Trésorerie',
        TRIAL_BALANCE: 'Balance'
      }
    }
  }
};

describe('AppSidebarComponent', () => {
  let fixture: ComponentFixture<AppSidebarComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        AppSidebarComponent,
        TranslocoTestingModule.forRoot({
          langs: translations,
          preloadLangs: true,
          translocoConfig: {
            availableLangs: ['fr'],
            defaultLang: 'fr'
          }
        })
      ],
      providers: [provideRouter([])]
    }).compileComponents();

    fixture = TestBed.createComponent(AppSidebarComponent);
    fixture.detectChanges();
  });

  it('renders the requested French navigation structure', () => {
    const text = fixture.nativeElement.textContent;

    expect(text).toContain('Tableau de bord');
    expect(text).toContain('Comptabilité');
    expect(text).toContain('Grand livre');
    expect(text).toContain('Journaux');
    expect(text).toContain('Écritures');
    expect(text).toContain('Balance');
    expect(text).toContain('Plan comptable');
    expect(text).toContain('Projets et fonds');
    expect(text).toContain('Trésorerie');
    expect(text).toContain('États OHADA');
    expect(text).toContain('Administration');
  });
});
