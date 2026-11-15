import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom, timeout } from 'rxjs';
import { RestaurantFiscalResultResponseSchema, RestaurantFiscalStatusResponseSchema } from '@liass-ohada/shared/restaurants';
import { RestaurantOrdersApi, ServiceOrderContext } from './restaurant-orders.api';
import { environment } from '../../../../environments/environment';
@Injectable({ providedIn: 'root' })
export class RestaurantFiscalApi {
  private readonly http = inject(HttpClient);
  private readonly context = inject(RestaurantOrdersApi);
  private creditPath(ctx: ServiceOrderContext, invoiceId: string, creditNoteId: string) {
    this.context.assertContext(ctx);
    return environment.apiBaseUrl.replace(/\/$/, '') +
      `/restaurants/outlets/${ctx.outlet}/sessions/${ctx.session}/invoices/${invoiceId}/fiscal`;
  }
  async creditResult(ctx: ServiceOrderContext, invoiceId: string, creditNoteId: string) {
    const value = RestaurantFiscalResultResponseSchema.parse(await firstValueFrom(
      this.http.get<unknown>(this.creditPath(ctx, invoiceId, creditNoteId) + '/result',
        { params: { creditNoteId } }).pipe(timeout(35000))));
    this.context.assertContext(ctx);
    if (value.invoiceId !== invoiceId || value.creditNoteId !== creditNoteId)
      throw new Error('Fiscal credit note mismatch');
    return value;
  }
  async initiateCredit(ctx: ServiceOrderContext, invoiceId: string, creditNoteId: string,
    attemptId: string, commandId: string) {
    const value = RestaurantFiscalStatusResponseSchema.parse(await firstValueFrom(
      this.http.post<unknown>(this.creditPath(ctx, invoiceId, creditNoteId),
        { creditNoteId, attemptId, commandId }).pipe(timeout(50000))));
    this.context.assertContext(ctx);
    if (value.invoiceId !== invoiceId || value.creditNoteId !== creditNoteId)
      throw new Error('Fiscal credit note mismatch');
    return value;
  }
  async confirmCredit(ctx: ServiceOrderContext, invoiceId: string, creditNoteId: string,
    commandId: string) {
    const value = RestaurantFiscalResultResponseSchema.parse(await firstValueFrom(
      this.http.put<unknown>(this.creditPath(ctx, invoiceId, creditNoteId) + '/confirm',
        { creditNoteId, commandId, confirm: true }).pipe(timeout(50000))));
    this.context.assertContext(ctx);
    if (value.invoiceId !== invoiceId || value.creditNoteId !== creditNoteId)
      throw new Error('Fiscal credit note mismatch');
    return value;
  }
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
