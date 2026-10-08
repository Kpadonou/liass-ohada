import { Injectable, inject } from '@angular/core';
import { queryOptions } from '@tanstack/angular-query-experimental';
import { ListSalesCreditNotesRequestSchema } from '@liass-ohada/shared/sales';
import type { z } from 'zod';

import { AuthStore } from '../../identity/data-access/auth.store';
import { SalesCreditNotesApi } from './sales-credit-notes.api';

const NO_TENANT_SCOPE = 'no-active-tenant';
type ListSalesCreditNotesRequest = z.input<typeof ListSalesCreditNotesRequestSchema>;

export const salesCreditNoteQueryKeys = {
  root: (orgId: string, invoiceId: string) =>
    ['sales', orgId, 'invoices', invoiceId, 'credit-notes'] as const,
  list: (orgId: string, invoiceId: string, options: ListSalesCreditNotesRequest) =>
    ['sales', orgId, 'invoices', invoiceId, 'credit-notes', { cursor: options.cursor ?? null, limit: options.limit ?? 50 }] as const,
  detail: (orgId: string, invoiceId: string, creditNoteId: string) =>
    ['sales', orgId, 'invoices', invoiceId, 'credit-notes', creditNoteId] as const,
  document: (orgId: string, invoiceId: string, creditNoteId: string) =>
    ['sales', orgId, 'invoices', invoiceId, 'credit-notes', creditNoteId, 'document', 'pdf'] as const
};

@Injectable({ providedIn: 'root' })
export class SalesCreditNotesQueries {
  private readonly api = inject(SalesCreditNotesApi);
  private readonly authStore = inject(AuthStore);

  tenantScope(): string { return this.authStore.effectiveOrgId() || NO_TENANT_SCOPE; }
  rootKey(invoiceId: string) { return salesCreditNoteQueryKeys.root(this.tenantScope(), invoiceId); }
  detailKey(invoiceId: string, creditNoteId: string) {
    return salesCreditNoteQueryKeys.detail(this.tenantScope(), invoiceId, creditNoteId);
  }
  documentKey(invoiceId: string, creditNoteId: string) {
    return salesCreditNoteQueryKeys.document(this.tenantScope(), invoiceId, creditNoteId);
  }

  list(invoiceId: string, options: ListSalesCreditNotesRequest, enabled = true) {
    return queryOptions({
      queryKey: salesCreditNoteQueryKeys.list(this.tenantScope(), invoiceId, options),
      queryFn: () => this.api.list(invoiceId, options),
      enabled: enabled && this.tenantScope() !== NO_TENANT_SCOPE && invoiceId.trim().length > 0,
      staleTime: 10_000,
      retry: false
    });
  }

  detail(invoiceId: string, creditNoteId: string, enabled = true) {
    return queryOptions({
      queryKey: this.detailKey(invoiceId, creditNoteId),
      queryFn: () => this.api.get(invoiceId, creditNoteId),
      enabled: enabled && this.tenantScope() !== NO_TENANT_SCOPE &&
        invoiceId.trim().length > 0 && creditNoteId.trim().length > 0,
      staleTime: 10_000,
      retry: false
    });
  }

  document(invoiceId: string, creditNoteId: string, enabled = true) {
    return queryOptions({
      queryKey: this.documentKey(invoiceId, creditNoteId),
      queryFn: () => this.api.getDocument(invoiceId, creditNoteId),
      enabled: enabled && this.tenantScope() !== NO_TENANT_SCOPE &&
        invoiceId.trim().length > 0 && creditNoteId.trim().length > 0,
      staleTime: 30_000,
      retry: false
    });
  }
}
