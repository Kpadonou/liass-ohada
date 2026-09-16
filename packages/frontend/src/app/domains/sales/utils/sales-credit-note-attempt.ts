import { HttpErrorResponse } from '@angular/common/http';
import type { IssueSalesCreditNoteRequest } from '@liass-ohada/shared/sales';

export function createSalesCreditNoteRequestId(): string {
  return crypto.randomUUID();
}

export function freezeSalesCreditNoteIssue(input: Omit<IssueSalesCreditNoteRequest, 'clientRequestId'>): IssueSalesCreditNoteRequest {
  return Object.freeze({ ...input, clientRequestId: createSalesCreditNoteRequestId() });
}

export function isAmbiguousSalesCreditNoteFailure(error: unknown): boolean {
  return error instanceof HttpErrorResponse && (error.status === 0 || error.status >= 500);
}
