import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';

import { AuthStore } from '../../identity/data-access/auth.store';
import { ProjectQueries } from './project-queries';
import { ProjectsApi } from './projects.api';

describe('ProjectQueries', () => {
  it('includes the effective organization in tenant-sensitive keys', () => {
    const effectiveOrgId = vi.fn().mockReturnValue('org-client');
    TestBed.configureTestingModule({
      providers: [
        ProjectQueries,
        { provide: ProjectsApi, useValue: {} },
        {
          provide: AuthStore,
          useValue: { effectiveOrgId }
        }
      ]
    });

    const queries = TestBed.inject(ProjectQueries);

    expect(queries.listProjects().queryKey).toEqual(['projects', 'org-client', 'list']);
    expect(queries.getProject('project-1').queryKey).toEqual([
      'projects',
      'org-client',
      'detail',
      'project-1'
    ]);
    expect(queries.getProjectsSummary('2026').queryKey).toEqual([
      'projects',
      'org-client',
      'summary',
      '2026'
    ]);

    effectiveOrgId.mockReturnValue('org-client-b');
    expect(queries.listProjects().queryKey).toEqual(['projects', 'org-client-b', 'list']);
  });
});
