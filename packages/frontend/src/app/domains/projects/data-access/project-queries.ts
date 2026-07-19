import { Injectable, inject } from '@angular/core';
import { queryOptions } from '@tanstack/angular-query-experimental';

import { AuthStore } from '../../identity/data-access/auth.store';
import { ProjectsApi } from './projects.api';

const NO_TENANT_SCOPE = 'no-active-tenant';

@Injectable({ providedIn: 'root' })
export class ProjectQueries {
  private readonly projectsApi = inject(ProjectsApi);
  private readonly authStore = inject(AuthStore);

  tenantScope(): string {
    return this.authStore.effectiveAccountingOrgId() || NO_TENANT_SCOPE;
  }

  listProjects() {
    return queryOptions({
      queryKey: ['projects', this.tenantScope(), 'list'] as const,
      queryFn: () => this.projectsApi.listProjects(),
      staleTime: 60_000
    });
  }

  getProject(projectId: string) {
    return queryOptions({
      queryKey: ['projects', this.tenantScope(), 'detail', projectId] as const,
      queryFn: () => this.projectsApi.getProject(projectId),
      enabled: projectId.length > 0,
      staleTime: 30_000
    });
  }

  listDonors() {
    return queryOptions({
      queryKey: ['projects', this.tenantScope(), 'donors'] as const,
      queryFn: () => this.projectsApi.listDonors(),
      staleTime: 60_000
    });
  }

  listFundingSources(projectId: string) {
    return queryOptions({
      queryKey: ['projects', this.tenantScope(), 'funding-sources', projectId] as const,
      queryFn: () => this.projectsApi.listFundingSources(projectId),
      enabled: projectId.length > 0,
      staleTime: 30_000
    });
  }

  listBudgetLines(projectId: string, year: string) {
    return queryOptions({
      queryKey: ['projects', this.tenantScope(), 'budget-lines', projectId, year] as const,
      queryFn: () => this.projectsApi.listBudgetLines(projectId, year),
      enabled: projectId.length > 0 && /^\d{4}$/.test(year),
      staleTime: 30_000
    });
  }

  getProjectReport(projectId: string, year: string) {
    return queryOptions({
      queryKey: ['projects', this.tenantScope(), 'report', projectId, year] as const,
      queryFn: () => this.projectsApi.getProjectReport(projectId, year),
      enabled: projectId.length > 0 && /^\d{4}$/.test(year),
      staleTime: 30_000
    });
  }

  getProjectsSummary(year: string) {
    return queryOptions({
      queryKey: ['projects', this.tenantScope(), 'summary', year] as const,
      queryFn: () => this.projectsApi.getProjectsSummary(year),
      enabled: /^\d{4}$/.test(year),
      staleTime: 30_000
    });
  }
}
