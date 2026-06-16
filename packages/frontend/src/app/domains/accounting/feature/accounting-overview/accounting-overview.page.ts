import { Component } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { TranslocoModule } from '@ngneat/transloco';

import { LiassPageHeaderComponent } from '../../../../shared/ui/page-header/page-header.component';
import { LiassStatusChipComponent, type LiassStatusTone } from '../../../../shared/ui/status-chip/status-chip.component';

interface AccountingEntryCard {
  descriptionKey: string;
  icon: string;
  labelKey: string;
  route: readonly string[];
  statusKey: string;
  tone: LiassStatusTone;
}

@Component({
  selector: 'liass-accounting-overview-page',
  host: {
    class: 'block'
  },
  imports: [LiassPageHeaderComponent, LiassStatusChipComponent, MatIconModule, RouterLink, TranslocoModule],
  templateUrl: './accounting-overview.page.html'
})
export class AccountingOverviewPage {
  protected readonly entryCards: readonly AccountingEntryCard[] = [
    {
      descriptionKey: 'ACCOUNTING.OVERVIEW.CARDS.CHART.DESCRIPTION',
      icon: 'format_list_numbered',
      labelKey: 'ACCOUNTING.OVERVIEW.CARDS.CHART.TITLE',
      route: ['/accounting/accounts'],
      statusKey: 'ACCOUNTING.OVERVIEW.CARDS.CHART.STATUS',
      tone: 'brand'
    },
    {
      descriptionKey: 'ACCOUNTING.OVERVIEW.CARDS.JOURNALS.DESCRIPTION',
      icon: 'menu_book',
      labelKey: 'ACCOUNTING.OVERVIEW.CARDS.JOURNALS.TITLE',
      route: ['/accounting/journals'],
      statusKey: 'ACCOUNTING.OVERVIEW.CARDS.JOURNALS.STATUS',
      tone: 'info'
    }
  ];
}
