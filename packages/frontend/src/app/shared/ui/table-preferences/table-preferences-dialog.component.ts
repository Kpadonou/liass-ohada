import { Component, inject, signal } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { TranslocoModule } from '@ngneat/transloco';

import { LiassButtonComponent } from '../button/button.component';
import {
  type LiassTableColumnPreference,
  type LiassTablePreferencesDialogData,
  type LiassTablePreferencesDialogResult
} from './table-preferences.model';
import { defaultVisibleColumnIds, normalizeVisibleColumnIds } from './table-preferences.storage';

@Component({
  selector: 'liass-table-preferences-dialog',
  imports: [LiassButtonComponent, MatDialogModule, MatIconModule, TranslocoModule],
  template: `
    <div class="w-full overflow-hidden bg-white dark:bg-slate-950">
      <header class="flex items-start justify-between gap-4 px-5 py-4 sm:px-6">
        <div class="min-w-0">
          <p class="text-xs font-semibold uppercase tracking-[0.16em] text-brand-700 dark:text-brand-300">
            {{ 'COMMON.TABLE.PREFERENCES_EYEBROW' | transloco }}
          </p>
          <h2 class="mt-1 text-xl font-semibold text-slate-950 dark:text-white" mat-dialog-title>
            {{ 'COMMON.TABLE.PREFERENCES_TITLE' | transloco }}
          </h2>
        </div>
        <button
          class="liass-focus-ring inline-flex size-9 shrink-0 items-center justify-center rounded-app-control text-slate-500 transition hover:bg-slate-100 hover:text-slate-950 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
          type="button"
          [attr.aria-label]="'COMMON.ACTIONS.CLOSE' | transloco"
          (click)="cancel()"
        >
          <mat-icon>close</mat-icon>
        </button>
      </header>

      <section class="border-t border-slate-200 px-5 py-4 dark:border-slate-800 sm:px-6">
        <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div class="min-w-0">
            <h3 class="text-sm font-semibold text-slate-950 dark:text-white">
              {{ 'COMMON.TABLE.VISIBLE_COLUMNS' | transloco }}
            </h3>
            <p class="mt-1 text-sm leading-6 text-slate-500 dark:text-slate-400">
              {{ 'COMMON.TABLE.VISIBLE_COLUMNS_DESCRIPTION' | transloco }}
            </p>
          </div>
          <liass-button tone="neutral" variant="ghost" icon="restart_alt" size="sm" (pressed)="resetSelection()">
            {{ 'COMMON.TABLE.RESET_PREFERENCES' | transloco }}
          </liass-button>
        </div>

        <div class="mt-4 flex flex-wrap gap-x-4 gap-y-2 rounded-app-card border border-slate-200 bg-slate-50/70 px-3 py-2 dark:border-slate-800 dark:bg-slate-900/50">
          <div class="flex items-center gap-2 text-xs font-medium text-slate-600 dark:text-slate-300">
            <span class="size-2.5 rounded-full bg-sky-300 ring-2 ring-sky-100 dark:bg-sky-300 dark:ring-sky-950"></span>
            <span>{{ 'COMMON.TABLE.LOCKED_COLUMN' | transloco }}</span>
          </div>
          <div class="flex items-center gap-2 text-xs font-medium text-slate-600 dark:text-slate-300">
            <span class="size-2.5 rounded-full bg-brand-700 ring-2 ring-brand-100 dark:bg-brand-400 dark:ring-brand-950"></span>
            <span>{{ 'COMMON.TABLE.VISIBLE_COLUMN' | transloco }}</span>
          </div>
          <div class="flex items-center gap-2 text-xs font-medium text-slate-600 dark:text-slate-300">
            <span class="size-2.5 rounded-full bg-slate-400 ring-2 ring-slate-200 dark:bg-slate-500 dark:ring-slate-800"></span>
            <span>{{ 'COMMON.TABLE.HIDDEN_COLUMN' | transloco }}</span>
          </div>
        </div>

        <div class="mt-4 max-h-[360px] overflow-y-auto rounded-app-card border border-slate-200 dark:border-slate-800">
          @for (column of data.columns; track column.id) {
            <button
              class="liass-focus-ring flex w-full items-center justify-between gap-4 border-b border-slate-100 px-4 py-3 text-left transition last:border-b-0 hover:bg-slate-50 disabled:cursor-not-allowed disabled:hover:bg-transparent dark:border-slate-800 dark:hover:bg-slate-900"
              type="button"
              role="switch"
              [disabled]="column.required"
              [attr.aria-checked]="isSelected(column)"
              [attr.data-testid]="'table-column-toggle-' + column.id"
              (click)="toggleColumn(column)"
            >
              <span class="min-w-0">
                <span class="block truncate text-sm font-semibold text-slate-950 dark:text-white">
                  {{ column.labelKey | transloco }}
                </span>
                @if (column.required) {
                  <span class="mt-1 inline-flex items-center gap-1 text-xs font-medium text-sky-700 dark:text-sky-300">
                    <mat-icon class="text-sm">lock</mat-icon>
                    {{ 'COMMON.TABLE.REQUIRED_COLUMN' | transloco }}
                  </span>
                }
              </span>
              <span
                class="relative inline-flex h-6 w-10 shrink-0 items-center rounded-full p-0.5 transition-colors"
                [class.bg-sky-200]="column.required"
                [class.bg-brand-700]="!column.required && isSelected(column)"
                [class.bg-slate-500]="!column.required && !isSelected(column)"
              >
                <span
                  class="inline-flex size-5 rounded-full bg-white shadow-app-sm transition-transform"
                  [class.translate-x-4]="isSelected(column)"
                ></span>
              </span>
            </button>
          }
        </div>
      </section>

      <footer class="flex flex-col-reverse gap-2 border-t border-slate-200 px-5 py-4 dark:border-slate-800 sm:flex-row sm:items-center sm:justify-end sm:px-6">
        <liass-button tone="neutral" variant="ghost" (pressed)="cancel()">
          {{ 'COMMON.ACTIONS.CANCEL' | transloco }}
        </liass-button>
        <liass-button tone="brand" variant="solid" icon="check" (pressed)="save()">
          {{ 'COMMON.ACTIONS.SAVE' | transloco }}
        </liass-button>
      </footer>
    </div>
  `
})
export class LiassTablePreferencesDialogComponent {
  protected readonly data = inject<LiassTablePreferencesDialogData>(MAT_DIALOG_DATA);
  private readonly dialogRef =
    inject<MatDialogRef<LiassTablePreferencesDialogComponent, LiassTablePreferencesDialogResult | undefined>>(
      MatDialogRef
    );

  protected readonly selectedColumnIds = signal(
    new Set(normalizeVisibleColumnIds(this.data.columns, this.data.visibleColumnIds))
  );

  protected isSelected(column: LiassTableColumnPreference): boolean {
    return column.required || this.selectedColumnIds().has(column.id);
  }

  protected toggleColumn(column: LiassTableColumnPreference): void {
    if (column.required) {
      return;
    }

    this.selectedColumnIds.update((columnIds) => {
      const nextColumnIds = new Set(columnIds);

      if (nextColumnIds.has(column.id)) {
        nextColumnIds.delete(column.id);
      } else {
        nextColumnIds.add(column.id);
      }

      return nextColumnIds;
    });
  }

  protected resetSelection(): void {
    this.selectedColumnIds.set(new Set(defaultVisibleColumnIds(this.data.columns)));
  }

  protected cancel(): void {
    this.dialogRef.close(undefined);
  }

  protected save(): void {
    this.dialogRef.close({
      visibleColumnIds: normalizeVisibleColumnIds(this.data.columns, [...this.selectedColumnIds()])
    });
  }
}
