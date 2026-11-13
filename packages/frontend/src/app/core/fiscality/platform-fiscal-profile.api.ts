import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom, timeout } from 'rxjs';
import { z } from 'zod';
import { OrganizationFiscalProfileSettingsSchema } from '@liass-ohada/shared/shared';
import { environment } from '../../../environments/environment';
import { fiscalWorkspaceEligible } from '../routing/auth.guards';
import { AuthStore } from '../../domains/identity/data-access/auth.store';

export interface PlatformFiscalContext {
  org: string;
  user: string;
  revision: number;
}

export const platformFiscalProfileKey = (context: PlatformFiscalContext) =>
  ['identity', 'fiscality', context.org, context.user, context.revision, 'profile'] as const;

/** Platform read boundary for domain consumers of the declared company regime. */
@Injectable({ providedIn: 'root' })
export class PlatformFiscalProfileApi {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthStore);
  private readonly url = environment.apiBaseUrl.replace(/\/$/, '') + '/me/organization/fiscality/profile';

  context(): PlatformFiscalContext {
    return {
      org: fiscalWorkspaceEligible(this.auth) ? (this.auth.effectiveOrgId() ?? '') : '',
      user: this.auth.currentUserId() ?? '',
      revision: this.auth.contextRevision(),
    };
  }

  async profile(context: PlatformFiscalContext) {
    const current = this.context();
    if (!context.org || !context.user || JSON.stringify(context) !== JSON.stringify(current))
      throw new HttpErrorResponse({ status: 409, error: { error: { code: 'WORKSPACE_CHANGED' } } });
    const response = await firstValueFrom(this.http.get<unknown>(this.url).pipe(timeout(35_000)));
    if (JSON.stringify(context) !== JSON.stringify(this.context()))
      throw new HttpErrorResponse({ status: 409, error: { error: { code: 'WORKSPACE_CHANGED' } } });
    return z.object({ data: OrganizationFiscalProfileSettingsSchema }).strict().parse(response).data;
  }
}
