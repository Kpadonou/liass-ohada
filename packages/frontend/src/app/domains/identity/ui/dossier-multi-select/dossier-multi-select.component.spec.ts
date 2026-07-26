import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import type { CabinetDossierSummary } from '@liass-ohada/shared/shared';
import { TranslocoTestingModule } from '@ngneat/transloco';

import { DossierMultiSelectComponent } from './dossier-multi-select.component';

const translations = {
  en: {
    IDENTITY: {
      CABINET_TEAM: {
        DOSSIER_SELECTOR: {
          LABEL: 'Dossiers to assign',
          SEARCH: 'Search dossiers',
          EMPTY: 'No matching dossier.',
          LOADING: 'Loading dossiers...',
          COUNT: '{{count}} selected',
          COUNT_WITH_MAX: '{{count}}/{{max}} selected',
          MAX_REACHED: 'Maximum {{max}} dossiers selected.'
        }
      },
      CABINET_DOSSIERS: {
        STATUS: {
          ACTIVE: 'Active',
          INACTIVE: 'Inactive'
        }
      },
      ONBOARDING: {
        COUNTRIES: {
          BENIN: 'Benin',
          TOGO: 'Togo'
        },
        FRAMEWORKS: {
          SYSCOHADA_REVISED: 'Revised SYSCOHADA',
          SYCEBNL: 'SYCEBNL'
        }
      }
    }
  }
};

const dossiers: CabinetDossierSummary[] = [
  {
    orgId: 'org-dona',
    displayName: 'DONA SHOP',
    country: 'BJ',
    accountingFramework: 'SYSCOHADA_REVISED',
    status: 'ACTIVE',
    accessMode: 'READ_WRITE',
    createdAt: '2026-07-20T00:00:00.000Z',
    updatedAt: '2026-07-20T00:00:00.000Z'
  },
  {
    orgId: 'org-ecobank',
    displayName: 'ECOBANK',
    country: 'BJ',
    accountingFramework: 'SYSCOHADA_REVISED',
    status: 'ACTIVE',
    accessMode: 'READ_WRITE',
    createdAt: '2026-07-20T00:00:00.000Z',
    updatedAt: '2026-07-20T00:00:00.000Z'
  },
  {
    orgId: 'org-re',
    displayName: 'RE',
    country: 'TG',
    accountingFramework: 'SYCEBNL',
    status: 'ACTIVE',
    accessMode: 'READ_WRITE',
    createdAt: '2026-07-20T00:00:00.000Z',
    updatedAt: '2026-07-20T00:00:00.000Z'
  }
];

@Component({
  imports: [DossierMultiSelectComponent],
  template: `
    <liass-dossier-multi-select
      [dossiers]="dossiers"
      [loading]="loading()"
      [maxSelected]="maxSelected()"
      [selectedIds]="selectedIds()"
      [showStatus]="true"
      (selectedIdsChange)="selectedIds.set($event)"
    />
  `
})
class HostComponent {
  dossiers = dossiers;
  loading = signal(false);
  maxSelected = signal<number | null>(null);
  selectedIds = signal<ReadonlySet<string>>(new Set(['org-dona']));
}

describe('DossierMultiSelectComponent', () => {
  let fixture: ComponentFixture<HostComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        HostComponent,
        TranslocoTestingModule.forRoot({
          langs: translations,
          preloadLangs: true,
          translocoConfig: { availableLangs: ['en'], defaultLang: 'en' }
        })
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
  });

  afterEach(() => TestBed.resetTestingModule());

  function text(): string {
    return fixture.nativeElement.textContent;
  }

  function search(value: string): void {
    const input = fixture.nativeElement.querySelector('input[type="search"]') as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  function checkboxInputs(): HTMLInputElement[] {
    return Array.from(fixture.nativeElement.querySelectorAll('input[type="checkbox"]'));
  }

  it('renders dossiers vertically with useful metadata and no raw orgId', () => {
    const rows = fixture.debugElement.queryAll(By.css('mat-checkbox'));
    expect(rows).toHaveLength(3);
    expect(text()).toContain('DONA SHOP');
    expect(text()).toContain('Benin');
    expect(text()).toContain('Revised SYSCOHADA');
    expect(text()).not.toContain('org-dona');
  });

  it('initializes selected dossiers and updates the selected count', () => {
    expect(checkboxInputs()[0]?.checked).toBe(true);
    expect(text()).toContain('1 selected');
  });

  it('selects and deselects dossiers through accessible checkboxes', () => {
    checkboxInputs()[1]?.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.selectedIds().has('org-ecobank')).toBe(true);
    expect(text()).toContain('2 selected');

    checkboxInputs()[0]?.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.selectedIds().has('org-dona')).toBe(false);
    expect(text()).toContain('1 selected');
  });

  it('filters results with normalized dossier search', () => {
    search('togo');
    expect(text()).toContain('RE');
    expect(text()).not.toContain('DONA SHOP');
    expect(text()).not.toContain('ECOBANK');
  });

  it('enforces the maximum selection without dropping existing selections', () => {
    fixture.componentInstance.maxSelected.set(1);
    fixture.detectChanges();

    expect(checkboxInputs()[0]?.disabled).toBe(false);
    expect(checkboxInputs()[1]?.disabled).toBe(true);
    expect(text()).toContain('1/1 selected');
    expect(text()).toContain('Maximum 1 dossiers selected.');
  });

  it('keeps selected values stable after search changes', () => {
    search('eco');
    checkboxInputs()[0]?.click();
    fixture.detectChanges();

    search('');
    expect(fixture.componentInstance.selectedIds().has('org-dona')).toBe(true);
    expect(fixture.componentInstance.selectedIds().has('org-ecobank')).toBe(true);
  });

  it('shows an empty state for searches without results', () => {
    search('missing');
    expect(text()).toContain('No matching dossier.');
  });

  it('shows a loading state instead of the result list', () => {
    fixture.componentInstance.loading.set(true);
    fixture.detectChanges();

    expect(text()).toContain('Loading dossiers...');
    expect(fixture.debugElement.queryAll(By.css('mat-checkbox'))).toHaveLength(0);
  });
});
