import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { By } from '@angular/platform-browser';
import { TranslocoTestingModule } from '@ngneat/transloco';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AccountingApi } from '../../data-access/accounting.api';
import {
  ThirdPartySelectComponent,
  type ThirdPartySelectedValue
} from './third-party-search-select.component';

const translations = {
  en: {
    ACCOUNTING: {
      THIRD_PARTIES: {
        SELECT: {
          EMPTY: 'No third party found',
          ERROR: 'Third parties could not be loaded.',
          LABEL: 'Third party',
          LOAD_MORE: 'Load more third parties',
          LOADING: 'Loading third parties...',
          PLACEHOLDER: 'Search by code or name',
          TYPE_TO_SEARCH: 'Enter a third-party code or name'
        },
        STATUS: {
          ACTIVE: 'Active',
          INACTIVE: 'Inactive'
        }
      }
    }
  }
};

@Component({
  imports: [ReactiveFormsModule, ThirdPartySelectComponent],
  template: `
    <liass-third-party-select
      [formControl]="control"
      [type]="type()"
      [required]="required"
      [showSelectedPreview]="showSelectedPreview"
      [status]="status"
      [limit]="limit"
      (thirdPartySelected)="selected = $event"
    />
  `
})
class ThirdPartySelectHostComponent {
  control = new FormControl<string | null>(null);
  type = signal<'CUSTOMER' | 'SUPPLIER'>('CUSTOMER');
  required = false;
  showSelectedPreview = false;
  status: 'ACTIVE' | 'INACTIVE' | 'ALL' = 'ACTIVE';
  limit = 200;
  selected: ThirdPartySelectedValue | null = null;
}

describe('ThirdPartySelectComponent', () => {
  let fixture: ComponentFixture<ThirdPartySelectHostComponent>;
  let accountingApi: {
    listThirdParties: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    accountingApi = {
      listThirdParties: vi.fn().mockResolvedValue({
        items: [customerAlpha(), supplierBeta()],
        hasMore: false
      })
    };

    await TestBed.configureTestingModule({
      imports: [
        ThirdPartySelectHostComponent,
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

    fixture = TestBed.createComponent(ThirdPartySelectHostComponent);
  });

  it('loads customer third parties when type is CUSTOMER', async () => {
    fixture.detectChanges();
    await settle(fixture);

    expect(accountingApi.listThirdParties).toHaveBeenCalledWith({
      type: 'CUSTOMER',
      status: 'ACTIVE',
      limit: 200
    });
  });

  it('loads supplier third parties when type is SUPPLIER', async () => {
    fixture.componentInstance.type.set('SUPPLIER');
    fixture.detectChanges();
    await settle(fixture);

    expect(accountingApi.listThirdParties).toHaveBeenCalledWith({
      type: 'SUPPLIER',
      status: 'ACTIVE',
      limit: 200
    });
  });

  it('displays options as CODE — displayName and never displays the thirdPartyId', async () => {
    fixture.detectChanges();
    await settle(fixture);

    const component = selectorComponent();
    expect(component.thirdPartyLabel(customerAlpha())).toBe('CUST-ALPHA — Client Alpha');
    expect(fixture.nativeElement.textContent).not.toContain('tp-cust-alpha');
  });

  it('filters loaded items locally by displayName', async () => {
    fixture.detectChanges();
    await settle(fixture);

    setSearchValue('alpha');
    fixture.detectChanges();

    const visible = selectorComponent().visibleThirdParties();
    expect(visible.map((party: { code: string }) => party.code)).toEqual(['CUST-ALPHA']);
  });

  it('filters loaded items locally by code', async () => {
    fixture.detectChanges();
    await settle(fixture);

    setSearchValue('cust');
    fixture.detectChanges();

    const visible = selectorComponent().visibleThirdParties();
    expect(visible.map((party: { displayName: string }) => party.displayName)).toEqual([
      'Client Alpha'
    ]);
  });

  it('emits the selected third party payload while the form stores the thirdPartyId', async () => {
    fixture.detectChanges();
    await settle(fixture);

    selectorComponent().selectOption({ option: { value: 'tp-cust-alpha' } });
    fixture.detectChanges();

    expect(fixture.componentInstance.control.value).toBe('tp-cust-alpha');
    expect(fixture.componentInstance.selected).toEqual({
      thirdPartyId: 'tp-cust-alpha',
      thirdPartyType: 'CUSTOMER',
      thirdPartyCode: 'CUST-ALPHA',
      thirdPartyName: 'Client Alpha'
    });
    expect(inputElement().value).toBe('CUST-ALPHA — Client Alpha');
    expect(fixture.nativeElement.textContent).not.toContain('tp-cust-alpha');
  });

  it('shows the selected third party in the field without rendering the preview by default', async () => {
    fixture.detectChanges();
    await settle(fixture);

    selectorComponent().selectOption({ option: { value: 'tp-cust-alpha' } });
    fixture.detectChanges();

    expect(inputElement().value).toBe('CUST-ALPHA — Client Alpha');
    expect(selectedPreview()).toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain('tp-cust-alpha');
  });

  it('renders the selected preview only when showSelectedPreview is true', async () => {
    fixture.componentInstance.showSelectedPreview = true;
    fixture.detectChanges();
    await settle(fixture);

    selectorComponent().selectOption({ option: { value: 'tp-cust-alpha' } });
    fixture.detectChanges();

    const preview = selectedPreview();
    expect(preview).toBeTruthy();
    expect(preview?.textContent).toContain('CUST-ALPHA');
    expect(preview?.textContent).toContain('Client Alpha');
    expect(preview?.textContent).not.toContain('tp-cust-alpha');
  });

  it('clears the selection when type changes and reloads the new type', async () => {
    fixture.detectChanges();
    await settle(fixture);
    selectorComponent().selectOption({ option: { value: 'tp-cust-alpha' } });
    fixture.detectChanges();
    await settle(fixture);

    fixture.componentInstance.type.set('SUPPLIER');
    fixture.detectChanges();
    await settle(fixture);

    expect(fixture.componentInstance.control.value).toBeNull();
    expect(fixture.componentInstance.selected).toBeNull();
    expect(inputElement().value).toBe('');
    expect(accountingApi.listThirdParties).toHaveBeenLastCalledWith({
      type: 'SUPPLIER',
      status: 'ACTIVE',
      limit: 200
    });
  });

  it('shows a loading state', async () => {
    let resolveLoad: (value: unknown) => void = () => undefined;
    accountingApi.listThirdParties.mockReturnValue(
      new Promise((resolve) => {
        resolveLoad = resolve;
      })
    );

    fixture.detectChanges();
    fixture.detectChanges();

    expect(selectorComponent().loading()).toBe(true);
    expect(fixture.nativeElement.querySelector('mat-spinner')).toBeTruthy();

    resolveLoad({ items: [], hasMore: false });
    await settle(fixture);
  });

  it('shows an empty state', async () => {
    accountingApi.listThirdParties.mockResolvedValue({ items: [], hasMore: false });

    fixture.detectChanges();
    await settle(fixture);
    selectorComponent().handleFocus();
    fixture.detectChanges();

    expect(selectorComponent().showNoResults()).toBe(true);
  });

  it('shows a clean error state', async () => {
    accountingApi.listThirdParties.mockRejectedValue(
      new Error('ZodError PK SK GSI ConditionalCheckFailedException')
    );

    fixture.detectChanges();
    await settle(fixture);

    expect(selectorComponent().searchError()).toBe(true);
    expect(fixture.nativeElement.textContent).not.toContain('GSI');
    expect(fixture.nativeElement.textContent).not.toContain('ConditionalCheckFailedException');
  });

  it('supports required validation', async () => {
    fixture.componentInstance.required = true;
    fixture.detectChanges();
    await settle(fixture);

    expect(fixture.componentInstance.control.hasError('required')).toBe(true);

    selectorComponent().selectOption({ option: { value: 'tp-cust-alpha' } });
    fixture.detectChanges();

    expect(fixture.componentInstance.control.valid).toBe(true);
  });

  function selectorComponent(): any {
    return fixture.debugElement.query(By.directive(ThirdPartySelectComponent)).componentInstance;
  }

  function inputElement(): HTMLInputElement {
    return fixture.nativeElement.querySelector('input') as HTMLInputElement;
  }

  function selectedPreview(): HTMLElement | null {
    return fixture.nativeElement.querySelector('[data-testid="third-party-selected-preview"]');
  }

  function setSearchValue(value: string): void {
    const input = inputElement();
    input.value = value;
    input.dispatchEvent(new Event('input'));
  }
});

async function settle(fixture: ComponentFixture<ThirdPartySelectHostComponent>): Promise<void> {
  for (let index = 0; index < 6; index += 1) {
    await fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve));
    fixture.detectChanges();
  }
}

function customerAlpha() {
  return thirdPartyFixture('tp-cust-alpha', 'CUST-ALPHA', 'Client Alpha', 'CUSTOMER');
}

function supplierBeta() {
  return thirdPartyFixture('tp-sup-beta', 'SUP-BETA', 'Fournisseur Beta', 'SUPPLIER');
}

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
