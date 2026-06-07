import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { TranslocoTestingModule } from '@ngneat/transloco';

import {
  LiassSearchableSelectComponent,
  type LiassSearchableSelectOption
} from './searchable-select.component';

const translations = {
  en: {
    COMMON: {
      SELECT: {
        NO_RESULTS: 'No results',
        SEARCH_PLACEHOLDER: 'Search...'
      }
    },
    IDENTITY: {
      ONBOARDING: {
        COUNTRIES: {
          BENIN: 'Benin',
          COTE_D_IVOIRE: "Côte d'Ivoire",
          SENEGAL: 'Senegal'
        },
        FIELDS: {
          COUNTRY: 'Country'
        }
      }
    }
  }
};

@Component({
  imports: [LiassSearchableSelectComponent, ReactiveFormsModule],
  template: `
    <liass-searchable-select
      icon="public"
      [emptyResultLabelKey]="'COMMON.SELECT.NO_RESULTS'"
      [labelKey]="'IDENTITY.ONBOARDING.FIELDS.COUNTRY'"
      [loading]="loading"
      [options]="options"
      [searchPlaceholderKey]="'COMMON.SELECT.SEARCH_PLACEHOLDER'"
      [formControl]="control"
    />
  `
})
class SearchableSelectHostComponent {
  control = new FormControl<string | null>('BJ');
  loading = false;
  options: LiassSearchableSelectOption[] = [
    { value: 'BJ', labelKey: 'IDENTITY.ONBOARDING.COUNTRIES.BENIN' },
    { value: 'CI', labelKey: 'IDENTITY.ONBOARDING.COUNTRIES.COTE_D_IVOIRE' },
    { value: 'SN', labelKey: 'IDENTITY.ONBOARDING.COUNTRIES.SENEGAL' }
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
            defaultLang: 'en'
          }
        })
      ]
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
      candidate.textContent?.includes('Senegal')
    ) as HTMLElement | undefined;
    option?.click();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(host.control.value).toBe('SN');
    expect(input.value).toBe('Senegal');
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
