import { Injectable, inject } from '@angular/core';
import { queryOptions } from '@tanstack/angular-query-experimental';
import type {
  ListAccountingWorksRequest,
  ListCabinetDeadlinesRequest
} from '@liass-ohada/shared/shared';

import { AuthStore } from './auth.store';
import { CabinetOperationsApi } from './cabinet-operations.api';
import { CabinetOperationsCapabilities } from './cabinet-operations-capabilities';

const NO_CABINET = 'no-active-cabinet';
const STALE_TIME = 20_000;

function normalizeWorkFilters(filters: ListAccountingWorksRequest) {
  return {
    cursor: filters.cursor ?? null,
    dossierOrgId: filters.dossierOrgId ?? null,
    dueFrom: filters.dueFrom ?? null,
    dueTo: filters.dueTo ?? null,
    limit: filters.limit ?? 25,
    periodEnd: filters.periodEnd ?? null,
    periodStart: filters.periodStart ?? null,
    priority: filters.priority ?? null,
    responsibleUserId: filters.responsibleUserId ?? null,
    status: filters.status ?? null,
    type: filters.type ?? null
  };
}

function normalizeDeadlineFilters(filters: ListCabinetDeadlinesRequest) {
  return {
    cursor: filters.cursor ?? null,
    dossierOrgId: filters.dossierOrgId ?? null,
    dueFrom: filters.dueFrom ?? null,
    dueTo: filters.dueTo ?? null,
    limit: filters.limit ?? 25,
    overdue: filters.overdue ?? null,
    priority: filters.priority ?? null,
    responsibleUserId: filters.responsibleUserId ?? null,
    status: filters.status ?? null,
    type: filters.type ?? null
  };
}

export const cabinetOperationsQueryKeys = {
  all: (cabinetOrgId: string) => ['cabinet-operations', cabinetOrgId] as const,
  deadline: (cabinetOrgId: string, deadlineId: string) =>
    ['cabinet-operations', cabinetOrgId, 'deadlines', deadlineId] as const,
  deadlines: (cabinetOrgId: string, filters: ListCabinetDeadlinesRequest) =>
    ['cabinet-operations', cabinetOrgId, 'deadlines', normalizeDeadlineFilters(filters)] as const,
  deadlinesRoot: (cabinetOrgId: string) =>
    ['cabinet-operations', cabinetOrgId, 'deadlines'] as const,
  work: (cabinetOrgId: string, workId: string) =>
    ['cabinet-operations', cabinetOrgId, 'works', workId] as const,
  works: (cabinetOrgId: string, filters: ListAccountingWorksRequest) =>
    ['cabinet-operations', cabinetOrgId, 'works', normalizeWorkFilters(filters)] as const,
  worksRoot: (cabinetOrgId: string) => ['cabinet-operations', cabinetOrgId, 'works'] as const
};

@Injectable({ providedIn: 'root' })
export class CabinetOperationsQueries {
  private readonly api = inject(CabinetOperationsApi);
  private readonly authStore = inject(AuthStore);
  private readonly capabilities = inject(CabinetOperationsCapabilities);

  scope(): string {
    return this.authStore.activeWorkspaceOrgId() ?? NO_CABINET;
  }

  all() {
    return cabinetOperationsQueryKeys.all(this.scope());
  }

  worksRoot() {
    return cabinetOperationsQueryKeys.worksRoot(this.scope());
  }

  deadlinesRoot() {
    return cabinetOperationsQueryKeys.deadlinesRoot(this.scope());
  }

  works(filters: ListAccountingWorksRequest) {
    return queryOptions({
      queryKey: cabinetOperationsQueryKeys.works(this.scope(), filters),
      queryFn: () => this.api.listWorks(filters),
      enabled: this.capabilities.canViewCabinetWork(),
      staleTime: STALE_TIME
    });
  }

  work(workId: string) {
    return queryOptions({
      queryKey: cabinetOperationsQueryKeys.work(this.scope(), workId),
      queryFn: () => this.api.getWork(workId),
      enabled: this.capabilities.canViewCabinetWork() && workId.length > 0,
      staleTime: STALE_TIME
    });
  }

  deadlines(filters: ListCabinetDeadlinesRequest) {
    return queryOptions({
      queryKey: cabinetOperationsQueryKeys.deadlines(this.scope(), filters),
      queryFn: () => this.api.listDeadlines(filters),
      enabled: this.capabilities.canViewCabinetDeadlines(),
      staleTime: STALE_TIME
    });
  }

  deadline(deadlineId: string) {
    return queryOptions({
      queryKey: cabinetOperationsQueryKeys.deadline(this.scope(), deadlineId),
      queryFn: () => this.api.getDeadline(deadlineId),
      enabled: this.capabilities.canViewCabinetDeadlines() && deadlineId.length > 0,
      staleTime: STALE_TIME
    });
  }
}
