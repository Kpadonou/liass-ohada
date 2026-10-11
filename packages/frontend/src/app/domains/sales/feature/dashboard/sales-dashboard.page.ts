import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { TranslocoModule } from '@ngneat/transloco';
import { LiassCardComponent } from '../../../../shared/ui/card/card.component';
import { LiassPageHeaderComponent } from '../../../../shared/ui/page-header/page-header.component';

@Component({
  selector: 'liass-sales-dashboard-page',
  host: { class: 'block' },
  imports: [
    RouterLink,
    MatIconModule,
    TranslocoModule,
    LiassCardComponent,
    LiassPageHeaderComponent,
  ],
  templateUrl: './sales-dashboard.page.html',
})
export class SalesDashboardPage {
  protected readonly shortcuts = [
    {
      route: '/sales/customers',
      icon: 'groups',
      labelKey: 'SHELL.NAV.SALES_CUSTOMERS',
      descriptionKey: 'SALES.DASHBOARD.CUSTOMERS',
    },
    {
      route: '/sales/items',
      icon: 'inventory_2',
      labelKey: 'SHELL.NAV.SALES_ITEMS',
      descriptionKey: 'SALES.DASHBOARD.ITEMS',
    },
    {
      route: '/sales/invoices',
      icon: 'receipt_long',
      labelKey: 'SHELL.NAV.SALES_INVOICES',
      descriptionKey: 'SALES.DASHBOARD.INVOICES',
    },
  ];
}
