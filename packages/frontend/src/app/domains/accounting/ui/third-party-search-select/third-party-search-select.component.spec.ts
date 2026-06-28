import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { By } from '@angular/platform-browser';
import { TranslocoTestingModule } from '@ngneat/transloco';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AccountingApi } from '../../data-access/accounting.api';
import { ThirdPartySearchSelectComponent } from './third-party-search-select.component';

const translations = {
  en: {
    ACCOUNTING: {
      LETTERING: {
        FIELDS: {
          THIRD_PARTY: 'Third party'
        },
        THIRD_PARTY_SELECT: {
          LOAD_MORE: 'Load more third parties',
          LOADING: 'Loading third parties...',
          NO_RESULTS: 'No third parties found',
          PLACEHOLDER: 'Search by third-party code',
          TYPE_TO_SEARCH: 'Type to search'
        }
      }
    },
    COMMON: {
      NOTIFICATIONS: {
        LOAD_ERROR: 'Loading failed.'
      }
    }
  }
};

@Component({
  imports: [ReactiveFormsModule, ThirdPartySearchSelectComponent],
  template: `<liass-third-party-search-select [formControl]="control" [type]="type" />`
})
class ThirdPartySearchSelectHostComponent {
  control = new FormControl<string | null>(null);
  type: 'CUSTOMER' | 'SUPPLIER' = 'CUSTOMER';
}

describe('ThirdPartySearchSelectComponent', () => {
  let fixture: ComponentFixture<ThirdPartySearchSelectHostComponent>;
  let accountingApi: {
    listThirdParties: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    accountingApi = {
      listThirdParties: vi.fn()
    };

    await TestBed.configureTestingModule({
      imports: [
        ThirdPartySearchSelectHostComponent,
        TranslocoTestingModule.forRoot({
          langs: translations,
          preloadLangs: true,
          translocoConfig: {
            availableLangs: ['en'],
            defaultLang: 'en'
          }
        })
      ],
      providers: [{ provide: AccountingApi, useValue: accountingApi }]
    }).compileComponents();

    fixture = TestBed.createComponent(ThirdPartySearchSelectHostComponent);
    fixture.detectChanges();
  });

  afterEach(() => {
    vi.useRealTimers();
    document.querySelectorAll('.cdk-overlay-container').forEach((container) => container.remove());
  });

  it('loads active third parties for the current type on focus', async () => {
    accountingApi.listThirdParties.mockResolvedValue({
      items: [thirdPartyFixture('tp-cust-alpha', 'CUST-ALPHA', 'Client Alpha', 'CUSTOMER')],
      hasMore: false
    });

    inputElement().dispatchEvent(new Event('focus'));
    fixture.detectChanges();
    await fixture.whenStable();

    expect(accountingApi.listThirdParties).toHaveBeenCalledWith({
      type: 'CUSTOMER',
      status: 'ACTIVE',
      limit: 50
    });
  });

  it('selects the business third-party id without crashing after the list has loaded', async () => {
    accountingApi.listThirdParties.mockResolvedValue({
      items: [thirdPartyFixture('tp-cust-alpha', 'CUST-ALPHA', 'Client Alpha', 'CUSTOMER')],
      hasMore: false
    });

    inputElement().dispatchEvent(new Event('focus'));
    fixture.detectChanges();
    await fixture.whenStable();

    const component = fixture.debugElement.query(
      By.directive(ThirdPartySearchSelectComponent)
    ).componentInstance as any;
    component.selectOption({ option: { value: 'tp-cust-alpha' } });
    fixture.detectChanges();

    expect(fixture.componentInstance.control.value).toBe('tp-cust-alpha');
    expect(inputElement().value).toBe('CUST-ALPHA — Client Alpha');
  });

  it('keeps typed text visible while invalidating a previous selection', async () => {
    accountingApi.listThirdParties.mockResolvedValue({
      items: [thirdPartyFixture('tp-cust-alpha', 'CUST-ALPHA', 'Client Alpha', 'CUSTOMER')],
      hasMore: false
    });

    inputElement().dispatchEvent(new Event('focus'));
    fixture.detectChanges();
    await fixture.whenStable();

    const component = fixture.debugElement.query(
      By.directive(ThirdPartySearchSelectComponent)
    ).componentInstance as any;
    component.selectOption({ option: { value: 'tp-cust-alpha' } });
    fixture.detectChanges();

    const input = inputElement();
    input.value = 'CUST';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    expect(fixture.componentInstance.control.value).toBeNull();
    expect(input.value).toBe('CUST');
  });

  function inputElement(): HTMLInputElement {
    return fixture.nativeElement.querySelector('input') as HTMLInputElement;
  }
});

function thirdPartyFixture(
  thirdPartyId: string,
  code: string,
  displayName: string,
  type: 'CUSTOMER' | 'SUPPLIER'
) {
  return {
    thirdPartyId,
    code,
    displayName,
    type,
    status: 'ACTIVE' as const,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  };
}
