import { HttpClient, HttpContext } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import {
  CabinetDashboardResponseSchema,
  type CabinetDashboardResponse
} from '@liass-ohada/shared/shared';
import { firstValueFrom } from 'rxjs';

import { environment } from '../../../../environments/environment';
import { TENANT_REQUEST_SCOPE } from '../../../core/http/tenant-request-context';

const cabinetContext = () => new HttpContext().set(TENANT_REQUEST_SCOPE, 'CABINET');

@Injectable({ providedIn: 'root' })
export class CabinetDashboardApi {
  private readonly http = inject(HttpClient);
  private readonly apiBaseUrl = environment.apiBaseUrl.replace(/\/$/, '');

  async getCabinetDashboard(): Promise<CabinetDashboardResponse> {
    const response = await firstValueFrom(
      this.http.get<unknown>(`${this.apiBaseUrl}/cabinet/dashboard`, {
        context: cabinetContext()
      })
    );

    return CabinetDashboardResponseSchema.parse(response);
  }
}
