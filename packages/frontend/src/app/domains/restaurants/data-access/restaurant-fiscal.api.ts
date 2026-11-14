import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom, timeout } from 'rxjs';
import { RestaurantFiscalResultResponseSchema } from '@liass-ohada/shared/restaurants';
import { RestaurantOrdersApi, ServiceOrderContext } from './restaurant-orders.api';
import { environment } from '../../../../environments/environment';
@Injectable({ providedIn: 'root' })
export class RestaurantFiscalApi {
  private readonly http = inject(HttpClient);
  private readonly context = inject(RestaurantOrdersApi);
  async result(ctx: ServiceOrderContext, invoiceId: string) {
    this.context.assertContext(ctx);
    const value = RestaurantFiscalResultResponseSchema.parse(
      await firstValueFrom(
        this.http
          .get<unknown>(
            environment.apiBaseUrl.replace(/\/$/, '') +
              `/restaurants/outlets/${ctx.outlet}/sessions/${ctx.session}/invoices/${invoiceId}/fiscal/result`,
          )
          .pipe(timeout(35000)),
      ),
    );
    this.context.assertContext(ctx);
    if (value.invoiceId !== invoiceId) throw new Error('Fiscal invoice mismatch');
    return value;
  }
}
