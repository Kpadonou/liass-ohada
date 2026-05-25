import { Injectable, inject } from '@angular/core';
import { queryOptions } from '@tanstack/angular-query-experimental';

import { ProjectsApi } from './projects.api';

@Injectable({ providedIn: 'root' })
export class ProjectQueries {
  private readonly projectsApi = inject(ProjectsApi);

  listProjects() {
    return queryOptions({
      queryKey: ['projects'] as const,
      queryFn: () => this.projectsApi.listProjects(),
      staleTime: 60_000
    });
  }
}
