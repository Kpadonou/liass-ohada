import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { z } from 'zod';
import { OrganizationProfileSchema, OrganizationContactUpdateSchema, OrganizationLegalAddressSaveSchema } from '@liass-ohada/shared/shared';
import { environment } from '../../../../environments/environment';
import { AuthStore } from './auth.store';
@Injectable({providedIn: 'root'})
export class OrganizationProfileApi {
  private readonly http = inject(HttpClient);
  readonly auth = inject(AuthStore);
  private readonly url = environment.apiBaseUrl.replace(/\/$/, '') + '/me/organization/profile';
  context() { return [this.auth.effectiveOrgId(), this.auth.currentUserId(), this.auth.contextRevision()] as const; }
  async read(context: ReturnType<OrganizationProfileApi['context']>) {
    return this.request(context, () => firstValueFrom(this.http.get<unknown>(this.url)));
  }
  async update(context: ReturnType<OrganizationProfileApi['context']>, input: unknown) {
    const body = z.union([OrganizationContactUpdateSchema, z.object({legalAddress: OrganizationLegalAddressSaveSchema}).strict()]).parse(input);
    return this.request(context, () => firstValueFrom(this.http.put<unknown>(this.url, body)));
  }
  private async request(context: ReturnType<OrganizationProfileApi['context']>, call: () => Promise<unknown>) {
    const check = () => { if (!context[0] || !context[1] || JSON.stringify(context) !== JSON.stringify(this.context())) throw new Error('WORKSPACE_CHANGED'); };
    check(); const response = await call(); check();
    const data = z.object({data: OrganizationProfileSchema}).parse(response).data;
    if (data.organization.orgId !== context[0]) throw new Error('WORKSPACE_CHANGED');
    return data;
  }
}
