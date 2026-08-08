import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { ProductAccessListResponseSchema, type ProductAccess } from '@liass-ohada/shared/shared';
import { firstValueFrom } from 'rxjs';

import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class ProductAccessApi {
  private readonly http = inject(HttpClient);
  private readonly apiBaseUrl = environment.apiBaseUrl.replace(/\/$/, '');

  async listProductAccess(expectedOrgId: string): Promise<ProductAccess[]> {
    const response = await firstValueFrom(
      this.http.get<unknown>(`${this.apiBaseUrl}/me/product-access`),
    );
    const parsed = ProductAccessListResponseSchema.parse(response);

    if (parsed.productAccess.some((access) => access.orgId !== expectedOrgId)) {
      throw new Error('ProductAccess response does not match the active organization.');
    }

    return parsed.productAccess;
  }
}
