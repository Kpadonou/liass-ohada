import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';

import { AuthStore } from '../../identity/data-access/auth.store';
import { ProjectQueries } from './project-queries';
import { ProjectsApi } from './projects.api';

describe('ProjectQueries', () => {
  it('includes the effective accounting organization in tenant-sensitive keys', () => {
    TestBed.configureTestingModule({
      providers: [
        ProjectQueries,
        { provide: ProjectsApi, useValue: {} },
        {
          provide: AuthStore,
          useValue: { effectiveAccountingOrgId: vi.fn().mockReturnValue('org-client') }
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
  });
});
