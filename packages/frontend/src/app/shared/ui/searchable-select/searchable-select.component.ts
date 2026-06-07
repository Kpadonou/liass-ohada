import { Component, computed, forwardRef, input, signal, inject } from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { MatAutocompleteModule, MatAutocompleteSelectedEvent } from '@angular/material/autocomplete';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { TranslocoModule, TranslocoService } from '@ngneat/transloco';

export interface LiassSearchableSelectOption {
  label?: string;
  labelKey?: string;
  value: string;
}

@Component({
  selector: 'liass-searchable-select',
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
      useExisting: forwardRef(() => LiassSearchableSelectComponent)
    }
  ],
  templateUrl: './searchable-select.component.html'
})
export class LiassSearchableSelectComponent implements ControlValueAccessor {
  readonly emptyResultLabelKey = input('COMMON.SELECT.NO_RESULTS');
  readonly errorKey = input<string | null>(null);
  readonly icon = input<string | null>(null);
  readonly labelKey = input.required<string>();
  readonly loading = input(false);
  readonly options = input<readonly LiassSearchableSelectOption[]>([]);
  readonly searchPlaceholderKey = input('COMMON.SELECT.SEARCH_PLACEHOLDER');
  readonly showError = input(false);

  protected readonly disabled = signal(false);
  protected readonly inputValue = signal('');
  private readonly selectedValue = signal<string | null>(null);
  private readonly transloco = inject(TranslocoService);

  protected readonly filteredOptions = computed(() => {
    const query = normalizeSearch(this.inputValue());
    const options = this.options();

    if (!query) {
      return options;
    }

    return options.filter((option) =>
      normalizeSearch(this.optionLabel(option)).includes(query)
    );
  });

  private onChange: (value: string | null) => void = () => undefined;
  private onTouched: () => void = () => undefined;

  writeValue(value: string | null): void {
    this.selectedValue.set(value || null);
    this.syncInputToSelectedValue();
  }

  registerOnChange(fn: (value: string | null) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(isDisabled: boolean): void {
    this.disabled.set(isDisabled);
  }

  protected handleInput(event: Event): void {
    this.inputValue.set((event.target as HTMLInputElement).value);
  }

  protected handleBlur(): void {
    this.onTouched();
    window.setTimeout(() => this.syncInputToSelectedValue(), 100);
  }

  protected selectOption(event: MatAutocompleteSelectedEvent): void {
    const value = `${event.option.value}`;
    this.selectedValue.set(value);
    this.onChange(value);
    this.syncInputToSelectedValue();
  }

  protected optionLabel(option: LiassSearchableSelectOption): string {
    return option.label ?? this.transloco.translate(option.labelKey ?? option.value);
  }

  private syncInputToSelectedValue(): void {
    const value = this.selectedValue();

    if (!value) {
      this.inputValue.set('');
      return;
    }

    const selectedOption = this.options().find((option) => option.value === value);
    this.inputValue.set(selectedOption ? this.optionLabel(selectedOption) : value);
  }
}

function normalizeSearch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}
