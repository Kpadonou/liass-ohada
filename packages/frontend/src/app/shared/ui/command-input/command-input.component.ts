import { Component, computed, input, output } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';

@Component({
  selector: 'liass-command-input',
  imports: [MatIconModule],
  templateUrl: './command-input.component.html'
})
export class LiassCommandInputComponent {
  readonly disabled = input(false);
  readonly leadingIcon = input('search');
  readonly placeholder = input.required<string>();
  readonly value = input('');

  readonly submitted = output<string>();
  readonly valueChange = output<string>();

  protected readonly inputClass = computed(() => {
    const disabled = this.disabled() ? 'text-app-text-disabled' : '';
    return `liass-focus-ring flex h-10 w-full items-center gap-2 rounded-app-control border border-app-border bg-app-input px-3 text-sm text-app-input-text shadow-app-xs transition focus-within:border-brand-300 ${disabled}`;
  });

  protected handleInput(event: Event): void {
    this.valueChange.emit((event.target as HTMLInputElement).value);
  }

  protected submit(): void {
    if (!this.disabled()) {
      this.submitted.emit(this.value());
    }
  }
}
