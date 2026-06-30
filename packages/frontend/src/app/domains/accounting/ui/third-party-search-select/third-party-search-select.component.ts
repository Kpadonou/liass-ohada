import {
  Component,
  computed,
  effect,
  forwardRef,
  inject,
  input,
  OnDestroy,
  output,
  signal
} from '@angular/core';
import {
  AbstractControl,
  ControlValueAccessor,
  NG_VALIDATORS,
  NG_VALUE_ACCESSOR,
  ValidationErrors,
  Validator
} from '@angular/forms';
import {
  MatAutocompleteModule,
  MatAutocompleteSelectedEvent
} from '@angular/material/autocomplete';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import {
  type ThirdPartyDto,
  type ThirdPartyStatusValue,
  type ThirdPartyTypeValue
} from '@liass-ohada/shared/accounting';
import { TranslocoModule } from '@ngneat/transloco';

import { AccountingApi } from '../../data-access/accounting.api';

const LOAD_MORE_VALUE = '__LOAD_MORE_THIRD_PARTIES__';
const DEFAULT_THIRD_PARTY_LIMIT = 200;

export interface ThirdPartySelectedValue {
  thirdPartyId: string;
  thirdPartyType: ThirdPartyTypeValue;
  thirdPartyCode: string;
  thirdPartyName: string;
}

type ThirdPartyStatusFilter = ThirdPartyStatusValue | 'ALL';

@Component({
  selector: 'liass-third-party-select',
  host: {
    class: 'block'
  },
  imports: [
    MatAutocompleteModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressSpinnerModule,
    TranslocoModule
  ],
  providers: [
    {
      multi: true,
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => ThirdPartySelectComponent)
    },
    {
      multi: true,
      provide: NG_VALIDATORS,
      useExisting: forwardRef(() => ThirdPartySelectComponent)
    }
  ],
  templateUrl: './third-party-search-select.component.html'
})
export class ThirdPartySelectComponent implements ControlValueAccessor, Validator, OnDestroy {
  readonly type = input<ThirdPartyTypeValue>('CUSTOMER');
  readonly label = input<string | null>(null);
  readonly placeholder = input<string | null>(null);
  readonly required = input(false);
  readonly disabledInput = input(false, { alias: 'disabled' });
  readonly showSelectedPreview = input(false);
  readonly status = input<ThirdPartyStatusFilter>('ACTIVE');
  readonly limit = input(DEFAULT_THIRD_PARTY_LIMIT);
  readonly showError = input(false);
  readonly errorKey = input<string | null>(null);
  readonly thirdPartySelected = output<ThirdPartySelectedValue | null>();

  private readonly accountingApi = inject(AccountingApi);
  private readonly selectedValue = signal<string | null>(null);
  private readonly thirdParties = signal<ThirdPartyDto[]>([]);
  private readonly nextCursor = signal<string | null>(null);
  private readonly requestSequence = signal(0);
  private currentType: ThirdPartyTypeValue = 'CUSTOMER';
  private currentStatus: ThirdPartyStatusFilter = 'ACTIVE';
  private currentLimit = DEFAULT_THIRD_PARTY_LIMIT;
  private hasInitialized = false;
  private isPropagatingInput = false;
  private onChange: (value: string | null) => void = () => undefined;
  private onTouched: () => void = () => undefined;
  private onValidatorChange: () => void = () => undefined;

  protected readonly searchText = signal('');
  protected readonly cvaDisabled = signal(false);
  protected readonly focused = signal(false);
  protected readonly loading = signal(false);
  protected readonly loadingMore = signal(false);
  protected readonly hasLoaded = signal(false);
  protected readonly searchError = signal(false);
  protected readonly hasMore = signal(false);

  protected readonly isDisabled = computed(() => this.disabledInput() || this.cvaDisabled());
  protected readonly selectedThirdPartyOption = computed(() => {
    const value = this.selectedValue();
    return this.thirdParties().find((party) => party.thirdPartyId === value) ?? null;
  });
  protected readonly visibleThirdParties = computed(() => {
    const query = normalizeSearch(this.searchText());
    const items = this.thirdParties().filter((party) => party.type === this.type());

    if (!query) {
      return items;
    }

    return items.filter((party) =>
      normalizeSearch(`${party.code} ${party.displayName}`).includes(query)
    );
  });

  protected readonly helperKey = computed(() => {
    if (!this.focused() || this.searchText().trim()) {
      return null;
    }

    return 'ACCOUNTING.THIRD_PARTIES.SELECT.TYPE_TO_SEARCH';
  });

  protected readonly showNoResults = computed(
    () =>
      this.focused() &&
      this.hasLoaded() &&
      !this.loading() &&
      !this.searchError() &&
      this.visibleThirdParties().length === 0
  );

  private readonly typeSync = effect(() => {
    const type = this.type();
    const status = this.status();
    const limit = this.normalizedLimit();
    if (this.hasInitialized && type === this.currentType && status === this.currentStatus && limit === this.currentLimit) {
      return;
    }

    const shouldClearSelection = this.hasInitialized;
    this.currentType = type;
    this.currentStatus = status;
    this.currentLimit = limit;
    this.hasInitialized = true;
    if (shouldClearSelection) {
      this.clearSelectedValue(true);
      this.searchText.set('');
    }
    this.reloadOptions();
  });

  ngOnDestroy(): void {
    this.typeSync.destroy();
  }

  writeValue(value: string | null): void {
    const normalizedValue = value || null;
    this.selectedValue.set(normalizedValue);

    if (!normalizedValue) {
      if (!this.isPropagatingInput) {
        this.searchText.set('');
      }
      return;
    }

    const selected = this.selectedThirdParty();
    this.searchText.set(selected ? this.thirdPartyLabel(selected) : '');
  }

  registerOnChange(fn: (value: string | null) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  registerOnValidatorChange(fn: () => void): void {
    this.onValidatorChange = fn;
  }

  validate(_: AbstractControl): ValidationErrors | null {
    return this.required() && !this.selectedValue() ? { required: true } : null;
  }

  setDisabledState(isDisabled: boolean): void {
    this.cvaDisabled.set(isDisabled);
  }

  protected handleFocus(): void {
    this.focused.set(true);
    if (!this.hasLoaded() && !this.loading()) {
      this.reloadOptions();
    }
  }

  protected handleBlur(): void {
    this.focused.set(false);
    this.onTouched();
    window.setTimeout(() => this.syncInputToSelectedValue(), 100);
  }

  protected handleInput(event: Event): void {
    this.searchText.set((event.target as HTMLInputElement).value);
    this.searchError.set(false);
    this.clearSelectedValue(true);

    if (!this.hasLoaded() && !this.loading()) {
      this.reloadOptions();
    }
  }

  protected selectOption(event: MatAutocompleteSelectedEvent): void {
    const value = `${event.option.value}`;

    if (value === LOAD_MORE_VALUE) {
      void this.loadMore();
      return;
    }

    const selected = this.thirdParties().find((party) => party.thirdPartyId === value);
    this.selectedValue.set(value);
    this.onChange(value);
    this.thirdPartySelected.emit(selected ? toSelectedValue(selected) : null);
    this.searchText.set(selected ? this.thirdPartyLabel(selected) : '');
    this.searchError.set(false);
    this.onValidatorChange();
  }

  protected thirdPartyLabel(party: ThirdPartyDto): string {
    return party.displayName;
  }

  protected loadMoreValue(): string {
    return LOAD_MORE_VALUE;
  }

  protected statusKey(party: ThirdPartyDto): string {
    return `ACCOUNTING.THIRD_PARTIES.STATUS.${party.status}`;
  }

  private reloadOptions(): void {
    this.thirdParties.set([]);
    this.nextCursor.set(null);
    this.hasMore.set(false);
    this.hasLoaded.set(false);
    this.searchError.set(false);
    void this.loadFirstPage(this.type());
  }

  private async loadFirstPage(type: ThirdPartyTypeValue): Promise<void> {
    const requestId = this.requestSequence() + 1;
    this.requestSequence.set(requestId);
    this.loading.set(true);
    this.hasLoaded.set(true);

    try {
      const result = await this.accountingApi.listThirdParties({
        type,
        ...(this.status() === 'ALL' ? {} : { status: this.status() as ThirdPartyStatusValue }),
        limit: this.normalizedLimit()
      });
      if (requestId !== this.requestSequence()) {
        return;
      }
      const items = mergeThirdParties(this.selectedThirdPartyArray(), result.items);
      this.thirdParties.set(items);
      const selected = items.find((party) => party.thirdPartyId === this.selectedValue());
      if (selected) {
        this.searchText.set(this.thirdPartyLabel(selected));
      }
      this.nextCursor.set(result.nextCursor ?? null);
      this.hasMore.set(result.hasMore && !!result.nextCursor);
    } catch {
      if (requestId === this.requestSequence()) {
        this.searchError.set(true);
        this.thirdParties.set(this.selectedThirdPartyArray());
        this.nextCursor.set(null);
        this.hasMore.set(false);
      }
    } finally {
      if (requestId === this.requestSequence()) {
        this.loading.set(false);
      }
    }
  }

  private async loadMore(): Promise<void> {
    const cursor = this.nextCursor();
    if (!cursor || this.loadingMore()) {
      return;
    }

    this.loadingMore.set(true);
    try {
      const result = await this.accountingApi.listThirdParties({
        type: this.type(),
        ...(this.status() === 'ALL' ? {} : { status: this.status() as ThirdPartyStatusValue }),
        cursor,
        limit: this.normalizedLimit()
      });
      this.thirdParties.update((items) => mergeThirdParties(items, result.items));
      this.nextCursor.set(result.nextCursor ?? null);
      this.hasMore.set(result.hasMore && !!result.nextCursor);
    } catch {
      this.searchError.set(true);
    } finally {
      this.loadingMore.set(false);
    }
  }

  private selectedThirdParty(): ThirdPartyDto | null {
    return this.selectedThirdPartyOption();
  }

  private selectedThirdPartyArray(): ThirdPartyDto[] {
    const selected = this.selectedThirdParty();
    return selected ? [selected] : [];
  }

  private syncInputToSelectedValue(): void {
    const value = this.selectedValue();

    if (!value) {
      this.searchText.set('');
      return;
    }

    const selected = this.selectedThirdParty();
    this.searchText.set(selected ? this.thirdPartyLabel(selected) : '');
  }

  private propagateNullFromInput(): void {
    this.isPropagatingInput = true;
    this.onChange(null);
    queueMicrotask(() => {
      this.isPropagatingInput = false;
    });
  }

  private clearSelectedValue(emitChange: boolean): void {
    if (!this.selectedValue() && !this.searchText()) {
      return;
    }

    this.selectedValue.set(null);
    if (emitChange) {
      this.propagateNullFromInput();
      this.thirdPartySelected.emit(null);
      this.onValidatorChange();
    }
  }

  private normalizedLimit(): number {
    const limit = Math.floor(Number(this.limit()));
    return Number.isFinite(limit) && limit > 0 ? Math.min(limit, 500) : DEFAULT_THIRD_PARTY_LIMIT;
  }
}

function mergeThirdParties(
  first: readonly ThirdPartyDto[],
  second: readonly ThirdPartyDto[]
): ThirdPartyDto[] {
  const parties = new Map<string, ThirdPartyDto>();

  for (const party of [...first, ...second]) {
    parties.set(`${party.type}:${party.thirdPartyId}`, party);
  }

  return [...parties.values()].sort((left, right) => left.code.localeCompare(right.code));
}

function normalizeSearch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function toSelectedValue(party: ThirdPartyDto): ThirdPartySelectedValue {
  return {
    thirdPartyId: party.thirdPartyId,
    thirdPartyType: party.type,
    thirdPartyCode: party.code,
    thirdPartyName: party.displayName
  };
}
