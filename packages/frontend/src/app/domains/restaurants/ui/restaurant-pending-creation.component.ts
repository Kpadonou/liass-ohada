import { Component, input } from '@angular/core';
import { injectQuery, QueryKey } from '@tanstack/angular-query-experimental';
import { TranslocoModule } from '@ngneat/transloco';
import { PendingCreation } from '../../../core/query-cache/optimistic-name';

/** Workflow preview only: no canonical resource ID, navigation or dependent actions. */
@Component({
  selector: 'liass-restaurant-pending-creation',
  imports: [TranslocoModule],
  template: `@for (row of pending.data() ?? []; track row.mutationId) {
    <p
      role="status"
      aria-live="polite"
      aria-busy="true"
      class="break-words text-sm text-app-text-secondary"
    >
      {{ row.name }} · {{ 'RESTAURANTS.UI.SAVING' | transloco }}
    </p>
  }`,
})
export class RestaurantPendingCreationComponent {
  readonly queryKey = input.required<QueryKey>();
  readonly pending = injectQuery(() => ({
    queryKey: this.queryKey(),
    queryFn: async (): Promise<PendingCreation[]> => [],
    enabled: false,
  }));
}
