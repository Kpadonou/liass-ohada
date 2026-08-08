import { Injectable, inject } from '@angular/core';
import { injectQuery } from '@tanstack/angular-query-experimental';
import type { ProductCode } from '@liass-ohada/shared/shared';

import { resolveProductAvailability, type ProductAvailability } from './product-availability';
import { ProductAccessQueries } from './product-access.queries';

@Injectable({ providedIn: 'root' })
export class ProductAccessState {
  private readonly queries = inject(ProductAccessQueries);
  private readonly productAccessQuery = injectQuery(() => this.queries.list());

  availability(productCode: ProductCode): ProductAvailability {
    return resolveProductAvailability(
      this.productAccessQuery.data(),
      productCode,
      this.productAccessQuery.isSuccess(),
    );
  }
}
