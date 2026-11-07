import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom, timeout } from 'rxjs';
import { z } from 'zod';
import {
  SfeApprovalViewSchema,
  OrganizationFiscalConnectionSchema,
  OrganizationFiscalSettingsSchema,
  PutOrganizationFiscalConnectionSchema,
  SubmitFiscalCredentialSchema,
  FiscalCredentialCommandSchema,
  VerifyFiscalConnectionRequestSchema,
  FiscalVerificationResultSchema,
} from '@liass-ohada/shared/shared';
import { AuthStore } from './auth.store';
import { environment } from '../../../../environments/environment';

export interface FiscalityContext {
  org: string;
  user: string;
  revision: number;
}
export const fiscalityKey = (context: FiscalityContext, environment: string) =>
  ['identity', 'fiscality', context.org, context.user, context.revision, environment] as const;
@Injectable({ providedIn: 'root' })
export class FiscalityApi {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthStore);
  private readonly base = environment.apiBaseUrl.replace(/\/$/, '') + '/me/organization/fiscality';
  context(): FiscalityContext {
    return {
      org: this.auth.effectiveOrgId() ?? '',
      user: this.auth.currentUserId() ?? '',
      revision: this.auth.contextRevision(),
    };
  }
  current(context: FiscalityContext) {
    const now = this.context();
    return (
      !!context.org &&
      !!context.user &&
      context.org === now.org &&
      context.user === now.user &&
      context.revision === now.revision
    );
  }
  private assert(context: FiscalityContext) {
    if (!this.current(context))
      throw new HttpErrorResponse({ status: 409, error: { error: { code: 'WORKSPACE_CHANGED' } } });
  }
  async approval(context: FiscalityContext) {
    this.assert(context);
    const result = await firstValueFrom(
      this.http.get<unknown>(this.base + '/sfe-approval').pipe(timeout(35_000)),
    );
    this.assert(context);
    return z.object({ data: SfeApprovalViewSchema }).strict().parse(result).data;
  }
  async list(context: FiscalityContext, environment: 'TEST' | 'PRODUCTION', cursor?: string) {
    this.assert(context);
    let params = new HttpParams().set('environment', environment);
    if (cursor) params = params.set('cursor', cursor);
    const result = await firstValueFrom(
      this.http.get<unknown>(this.base + '/connections', { params }).pipe(timeout(35_000)),
    );
    this.assert(context);
    const data = z.object({ data: OrganizationFiscalSettingsSchema }).strict().parse(result).data;
    if (
      data.environment !== environment ||
      data.connections.some((connection) => connection.environment !== environment)
    )
      throw new Error('Fiscal environment mismatch');
    return data;
  }
  async verify(context: FiscalityContext, input: unknown) {
    this.assert(context);
    const { connectionId, ...body } = VerifyFiscalConnectionRequestSchema.parse(input);
    const response = await firstValueFrom(
      this.http
        .post<unknown>(
          this.base + '/connections/' + encodeURIComponent(connectionId) + '/verification',
          body,
        )
        .pipe(timeout(35_000)),
    );
    this.assert(context);
    const result = z
      .object({ data: FiscalVerificationResultSchema, message: z.unknown().optional() })
      .strict()
      .parse(response);
    if (
      result.data.environment !== body.environment ||
      result.data.operationId !== body.commandId ||
      result.data.configurationVersion !== body.expectedVersion
    )
      throw new HttpErrorResponse({ status: 409, error: { error: { code: 'WORKSPACE_CHANGED' } } });
    return result;
  }
  /** Deliberately outside TanStack mutation variables/cache: credentials live only in this request. */
  async change(
    context: FiscalityContext,
    kind: 'CONFIGURE' | 'STORE_CREDENTIAL' | 'REVOKE_CREDENTIAL',
    input: unknown,
  ) {
    this.assert(context);
    const request =
      kind === 'CONFIGURE'
        ? PutOrganizationFiscalConnectionSchema.parse(input)
        : kind === 'STORE_CREDENTIAL'
          ? SubmitFiscalCredentialSchema.parse(input)
          : FiscalCredentialCommandSchema.parse(input);
    const { connectionId, ...body } = request;
    const url =
      this.base +
      '/connections/' +
      encodeURIComponent(connectionId) +
      (kind === 'CONFIGURE' ? '' : '/credential');
    const observable =
      kind === 'REVOKE_CREDENTIAL'
        ? this.http.delete<unknown>(url, { body })
        : this.http.put<unknown>(url, body);
    const response = await firstValueFrom(observable.pipe(timeout(35_000)));
    this.assert(context);
    const result = z
      .object({ data: OrganizationFiscalConnectionSchema, message: z.unknown().optional() })
      .strict()
      .parse(response);
    if (
      result.data.connectionId !== connectionId ||
      result.data.environment !== request.environment
    )
      throw new Error('Fiscal connection mismatch');
    return result;
  }
}
