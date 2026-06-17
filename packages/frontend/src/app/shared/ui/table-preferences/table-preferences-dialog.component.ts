import { Component, inject, signal } from '@angular/core';
import { MatCheckboxModule } from '@angular/material/checkbox';
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
  imports: [LiassButtonComponent, MatCheckboxModule, MatDialogModule, MatIconModule, TranslocoModule],
  template: `
    <div class="space-y-6 p-6">
      <header class="space-y-2">
        <p class="text-xs font-semibold uppercase tracking-[0.16em] text-brand-700 dark:text-brand-300">
          {{ 'COMMON.TABLE.PREFERENCES_EYEBROW' | transloco }}
        </p>
        <h2 class="text-xl font-semibold text-slate-950 dark:text-white" mat-dialog-title>
          {{ 'COMMON.TABLE.PREFERENCES_TITLE' | transloco }}
        </h2>
        <p class="text-sm leading-6 text-slate-500 dark:text-slate-400">
          {{ 'COMMON.TABLE.VISIBLE_COLUMNS_DESCRIPTION' | transloco }}
        </p>
      </header>

      <section class="rounded-app-card border border-slate-200 p-4 dark:border-slate-800">
        <h3 class="text-sm font-semibold text-slate-950 dark:text-white">
          {{ 'COMMON.TABLE.VISIBLE_COLUMNS' | transloco }}
        </h3>
        <div class="mt-4 grid gap-3">
          @for (column of data.columns; track column.id) {
            <mat-checkbox
              color="primary"
              [checked]="isSelected(column)"
              [disabled]="column.required"
              [attr.data-testid]="'table-column-toggle-' + column.id"
              (change)="toggleColumn(column)"
            >
              <span class="font-medium text-slate-800 dark:text-slate-100">
                {{ column.labelKey | transloco }}
              </span>
              @if (column.required) {
                <span class="ml-2 text-xs text-slate-500 dark:text-slate-400">
                  {{ 'COMMON.TABLE.REQUIRED_COLUMN' | transloco }}
                </span>
              }
            </mat-checkbox>
          }
        </div>
      </section>

      <footer class="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
        <liass-button tone="neutral" variant="ghost" icon="restart_alt" (pressed)="resetSelection()">
          {{ 'COMMON.TABLE.RESET_PREFERENCES' | transloco }}
        </liass-button>
        <div class="flex justify-end gap-3">
          <liass-button tone="neutral" variant="outline" (pressed)="cancel()">
            {{ 'COMMON.ACTIONS.CANCEL' | transloco }}
          </liass-button>
          <liass-button tone="brand" variant="solid" icon="check" (pressed)="save()">
            {{ 'COMMON.ACTIONS.SAVE' | transloco }}
          </liass-button>
        </div>
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
