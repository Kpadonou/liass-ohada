import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import {
  CreateInitialWorkspaceRequestSchema,
  CreateInitialWorkspaceResponseSchema,
  type CreateInitialWorkspaceRequest,
  type CreateInitialWorkspaceResponse
} from '@liass-ohada/shared/shared';
import { firstValueFrom } from 'rxjs';

import { environment } from '../../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class OnboardingApi {
  private readonly http = inject(HttpClient);
  private readonly apiBaseUrl = environment.apiBaseUrl.replace(/\/$/, '');

  async createInitialWorkspace(
    payload: CreateInitialWorkspaceRequest
  ): Promise<CreateInitialWorkspaceResponse> {
    const request = CreateInitialWorkspaceRequestSchema.parse(payload);
    const response = await firstValueFrom(
      this.http.post<unknown>(`${this.apiBaseUrl}/me/workspaces`, request)
    );

    return CreateInitialWorkspaceResponseSchema.parse(response);
  }
}
