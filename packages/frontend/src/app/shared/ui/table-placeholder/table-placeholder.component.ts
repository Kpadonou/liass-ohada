import { Component, input } from '@angular/core';
import { TranslocoModule } from '@ngneat/transloco';

import { LiassStatusChipComponent, type LiassStatusTone } from '../status-chip/status-chip.component';

export interface LiassTableColumn {
  key: string;
  labelKey: string;
  align?: 'left' | 'center' | 'right';
}

export interface LiassTableCell {
  emphasis?: boolean;
  tone?: LiassStatusTone;
  valueKey: string;
}

export interface LiassTableRow {
  cells: Record<string, LiassTableCell>;
  id: string;
}

@Component({
  selector: 'liass-table-placeholder',
  imports: [LiassStatusChipComponent, TranslocoModule],
  templateUrl: './table-placeholder.component.html'
})
export class LiassTablePlaceholderComponent {
  readonly columns = input.required<readonly LiassTableColumn[]>();
  readonly emptyLabel = input.required<string>();
  readonly rows = input.required<readonly LiassTableRow[]>();

  protected cell(row: LiassTableRow, column: LiassTableColumn): LiassTableCell | null {
    return row.cells[column.key] ?? null;
  }

  protected cellClass(row: LiassTableRow, column: LiassTableColumn): string {
    const base = 'py-3 text-sm text-slate-600 dark:text-slate-400';
    const align = column.align === 'right' ? 'text-right' : column.align === 'center' ? 'text-center' : 'text-left';
    const emphasis = this.cell(row, column)?.emphasis ? 'font-semibold text-slate-950 dark:text-white' : '';
    return `${base} ${align} ${emphasis}`;
  }

  protected headerClass(column: LiassTableColumn): string {
    const align = column.align === 'right' ? 'text-right' : column.align === 'center' ? 'text-center' : 'text-left';
    return `py-3 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400 ${align}`;
  }
}
