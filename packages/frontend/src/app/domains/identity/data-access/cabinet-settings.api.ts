import { HttpClient, HttpContext } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import {
  GetCabinetSettingsResponseSchema,
  UpdateCabinetSettingsRequestSchema,
  UpdateCabinetSettingsResponseSchema,
  type CabinetSettings,
  type UpdateCabinetSettingsRequest
} from '@liass-ohada/shared/shared';
import { firstValueFrom } from 'rxjs';

import { environment } from '../../../../environments/environment';
import { TENANT_REQUEST_SCOPE } from '../../../core/http/tenant-request-context';

const cabinetContext = () => new HttpContext().set(TENANT_REQUEST_SCOPE, 'CABINET');

@Injectable({ providedIn: 'root' })
export class CabinetSettingsApi {
  private readonly http = inject(HttpClient);
  private readonly apiBaseUrl = environment.apiBaseUrl.replace(/\/$/, '');

  async getCabinetSettings(): Promise<CabinetSettings> {
    const response = await firstValueFrom(
      this.http.get<unknown>(`${this.apiBaseUrl}/cabinet/settings`, {
        context: cabinetContext()
      })
    );

    return GetCabinetSettingsResponseSchema.parse(response);
  }

  async updateCabinetSettings(request: UpdateCabinetSettingsRequest): Promise<CabinetSettings> {
    const validatedRequest = UpdateCabinetSettingsRequestSchema.parse(request);
    const response = await firstValueFrom(
      this.http.patch<unknown>(`${this.apiBaseUrl}/cabinet/settings`, validatedRequest, {
        context: cabinetContext()
      })
    );

    return UpdateCabinetSettingsResponseSchema.parse(response);
  }
}
