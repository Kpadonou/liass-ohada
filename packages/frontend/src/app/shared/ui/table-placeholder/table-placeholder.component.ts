import { Component, input } from '@angular/core';
import { TranslocoModule } from '@ngneat/transloco';

import { LiassSkeletonComponent } from '../skeleton/skeleton.component';
import { LiassStatusChipComponent, type LiassStatusTone } from '../status-chip/status-chip.component';

export type LiassTableState = 'default' | 'loading' | 'empty';

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
  host: {
    class: 'block'
  },
  imports: [LiassSkeletonComponent, LiassStatusChipComponent, TranslocoModule],
  templateUrl: './table-placeholder.component.html'
})
export class LiassTablePlaceholderComponent {
  readonly columns = input.required<readonly LiassTableColumn[]>();
  readonly emptyLabel = input.required<string>();
  readonly rows = input.required<readonly LiassTableRow[]>();
  readonly skeletonRows = input(3);
  readonly state = input<LiassTableState>('default');

  protected readonly skeletonCells = [0, 1, 2, 3];

  protected skeletonRowItems(): readonly number[] {
    return Array.from({ length: Math.max(1, this.skeletonRows()) }, (_, index) => index);
  }

  protected cell(row: LiassTableRow, column: LiassTableColumn): LiassTableCell | null {
    return row.cells[column.key] ?? null;
  }

  protected cellClass(row: LiassTableRow, column: LiassTableColumn): string {
    const base = 'px-4 py-3 text-sm text-slate-600 first:pl-0 last:pr-0 dark:text-slate-400 md:first:pl-0 md:last:pr-0';
    const align = column.align === 'right' ? 'text-right' : column.align === 'center' ? 'text-center' : 'text-left';
    const emphasis = this.cell(row, column)?.emphasis ? 'font-semibold text-slate-950 dark:text-white' : '';
    return `${base} ${align} ${emphasis}`;
  }

  protected headerClass(column: LiassTableColumn): string {
    const align = column.align === 'right' ? 'text-right' : column.align === 'center' ? 'text-center' : 'text-left';
    return `px-4 py-3 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500 first:pl-0 last:pr-0 dark:text-slate-400 md:first:pl-0 md:last:pr-0 ${align}`;
  }

  protected visibleRows(): readonly LiassTableRow[] {
    return this.state() === 'default' ? this.rows() : [];
  }
}
