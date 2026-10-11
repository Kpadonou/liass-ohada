import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { TranslocoTestingModule } from '@ngneat/transloco';

import {
  LiassSearchableSelectComponent,
  type LiassSearchableSelectOption,
} from './searchable-select.component';

const translations = {
  en: {
    COMMON: {
      SELECT: {
        NO_RESULTS: 'No results',
        SEARCH_PLACEHOLDER: 'Search...',
      },
    },
    IDENTITY: {
      ONBOARDING: {
        COUNTRIES: {
          BENIN: 'Benin',
          COTE_D_IVOIRE: "Côte d'Ivoire",
          SENEGAL: 'Senegal',
        },
        FIELDS: {
          COUNTRY: 'Country',
        },
      },
    },
  },
};

@Component({
  imports: [LiassSearchableSelectComponent, ReactiveFormsModule],
  template: `
    <liass-searchable-select
      icon="public"
      [controlType]="controlType"
      [emptyResultLabelKey]="'COMMON.SELECT.NO_RESULTS'"
      [labelKey]="'IDENTITY.ONBOARDING.FIELDS.COUNTRY'"
      [loading]="loading"
      [unresolvedLabelKey]="unresolvedLabelKey"
      [options]="options"
      [searchPlaceholderKey]="'COMMON.SELECT.SEARCH_PLACEHOLDER'"
      [formControl]="control"
    />
  `,
})
class SearchableSelectHostComponent {
  controlType: 'autocomplete' | 'select' = 'autocomplete';
  control = new FormControl<string | null>('BJ');
  loading = false;
  unresolvedLabelKey: string | null = null;
  options: LiassSearchableSelectOption[] = [
    { value: 'BJ', labelKey: 'IDENTITY.ONBOARDING.COUNTRIES.BENIN' },
    { value: 'CI', labelKey: 'IDENTITY.ONBOARDING.COUNTRIES.COTE_D_IVOIRE' },
    { value: 'SN', labelKey: 'IDENTITY.ONBOARDING.COUNTRIES.SENEGAL' },
  ];
}

describe('LiassSearchableSelectComponent', () => {
  let fixture: ComponentFixture<SearchableSelectHostComponent>;
  let host: SearchableSelectHostComponent;

  beforeEach(async () => {
    TestBed.resetTestingModule();

    await TestBed.configureTestingModule({
      imports: [
        SearchableSelectHostComponent,
        TranslocoTestingModule.forRoot({
          langs: translations,
          preloadLangs: true,
          translocoConfig: {
            availableLangs: ['en'],
            defaultLang: 'en',
          },
        }),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(SearchableSelectHostComponent);
    host = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => {
    document.querySelectorAll('.cdk-overlay-container').forEach((container) => container.remove());
  });

  it('renders the selected option label from the form value', () => {
    const input = inputElement();

    expect(input.value).toBe('Benin');
  });

  it('supports direct labels for dynamic domain options', () => {
    host.options.splice(0, host.options.length, {
      value: '41100000',
      label: '41100000 - Clients',
    });
    host.control.setValue('41100000');
    fixture.detectChanges();

    expect(inputElement().value).toBe('41100000 - Clients');
  });

  it('filters options case-insensitively and accent-insensitively', async () => {
    const input = inputElement();
    input.focus();
    input.value = 'cote';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    await fixture.whenStable();

    const overlayText = document.body.textContent ?? '';
    expect(overlayText).toContain("Côte d'Ivoire");
    expect(overlayText).not.toContain('Senegal');
  });

  it('shows the translated no-results state', async () => {
    const input = inputElement();
    input.focus();
    input.value = 'missing';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    await fixture.whenStable();

    expect(document.body.textContent).toContain('No results');
  });

  it('emits the selected option value to Angular forms', async () => {
    const input = inputElement();
    input.focus();
    input.value = 'sen';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    await fixture.whenStable();

    const option = Array.from(document.body.querySelectorAll('mat-option')).find((candidate) =>
      candidate.textContent?.includes('Senegal'),
    ) as HTMLElement | undefined;
    option?.click();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(host.control.value).toBe('SN');
    expect(input.value).toBe('Senegal');
  });

  it('masks an unresolved identifier and resolves its label when options arrive', () => {
    host.options = [];
    fixture.changeDetectorRef.markForCheck();
    host.unresolvedLabelKey = 'COMMON.SELECT.SEARCH_PLACEHOLDER';
    host.control.setValue('opaque-reference');
    fixture.detectChanges();
    expect(inputElement().value).toBe('Search...');
    host.options = [{ value: 'opaque-reference', label: 'Agla' }];
    fixture.changeDetectorRef.markForCheck();
    fixture.detectChanges();
    expect(inputElement().value).toBe('Agla');
  });

  it('preserves active search when options refresh', () => {
    const input = inputElement();
    input.value = 'ter';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    host.options = [{ value: 'terrace', label: 'Terrace' }];
    fixture.changeDetectorRef.markForCheck();
    fixture.detectChanges();
    expect(input.value).toBe('ter');
  });

  it('offers constrained Material Select with search for growing references and preserves the selected label', async () => {
    host.controlType = 'select';
    host.options = Array.from({ length: 12 }, (_, index) => ({
      value: String(index),
      label: `Station ${index}`,
    }));
    host.control.setValue('0');
    fixture.changeDetectorRef.markForCheck();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('mat-select').textContent).toContain('Station 0');
    const search = fixture.nativeElement.querySelector('input') as HTMLInputElement;
    search.value = 'Station 11';
    search.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('mat-select').textContent).toContain('Station 0');
    (fixture.nativeElement.querySelector('.mat-mdc-select-trigger') as HTMLElement).click();
    fixture.detectChanges();
    await fixture.whenStable();
    const option = Array.from(document.body.querySelectorAll('mat-option')).find((node) =>
      node.textContent?.includes('Station 11'),
    ) as HTMLElement;
    option.click();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(host.control.value).toBe('11');
  });

  it('handles disabled and loading states', () => {
    host.control.disable();
    host.loading = true;
    fixture.detectChanges();

    expect(inputElement().disabled).toBe(true);
    expect(fixture.nativeElement.textContent).toContain('Country');
  });

  function inputElement(): HTMLInputElement {
    return fixture.nativeElement.querySelector('input') as HTMLInputElement;
  }
});
