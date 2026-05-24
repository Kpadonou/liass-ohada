import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { WorkspaceSummary } from '@liass-ohada/shared/shared';
import { firstValueFrom } from 'rxjs';

import { environment } from '../../environments/environment';

@Injectable({ providedIn: 'root' })
export class WorkspacesApi {
  private readonly http = inject(HttpClient);
  private readonly apiBaseUrl = environment.apiBaseUrl.replace(/\/$/, '');

  async listWorkspaces(): Promise<WorkspaceSummary[]> {
    const response = await firstValueFrom(
      this.http.get<unknown>(`${this.apiBaseUrl}/me/workspaces`)
    );
    const { WorkspacesResponseSchema } = await import('@liass-ohada/shared/shared');

    return WorkspacesResponseSchema.parse(response).workspaces;
  }
}
