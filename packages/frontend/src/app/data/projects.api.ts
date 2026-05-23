import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { ProjectSchema, type Project } from '@liass-ohada/shared';
import { firstValueFrom } from 'rxjs';

import { environment } from '../../environments/environment';

@Injectable({ providedIn: 'root' })
export class ProjectsApi {
  private readonly http = inject(HttpClient);
  private readonly apiBaseUrl = environment.apiBaseUrl.replace(/\/$/, '');

  async listProjects(): Promise<Project[]> {
    const response = await firstValueFrom(
      this.http.get<unknown>(`${this.apiBaseUrl}/projects`)
    );

    if (!response || typeof response !== 'object' || !('projects' in response)) {
      throw new Error('Invalid projects response');
    }

    return ProjectSchema.array().parse(
      (response as { projects: unknown }).projects
    );
  }
}
