import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { WorkspaceSummary } from '@liass-ohada/shared/shared';
import { firstValueFrom } from 'rxjs';

import { environment } from '../../../../environments/environment';

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function parseWorkspaceSummary(value: unknown): WorkspaceSummary {
  if (!isRecord(value) || typeof value['orgId'] !== 'string' || !value['orgId'].trim()) {
    throw new Error('Invalid workspace discovery response.');
  }

  const workspaceType =
    value['workspaceType'] === 'COMPANY' || value['workspaceType'] === 'ACCOUNTING_FIRM'
      ? value['workspaceType']
      : undefined;
  const role = optionalString(value['role']);
  const cabinetRole =
    value['cabinetRole'] === 'CABINET_ADMIN' ||
    value['cabinetRole'] === 'SUPERVISOR' ||
    value['cabinetRole'] === 'COLLABORATOR' ||
    value['cabinetRole'] === 'READER'
      ? value['cabinetRole']
      : workspaceType === 'ACCOUNTING_FIRM' && role === 'OWNER'
        ? 'CABINET_ADMIN'
        : undefined;

  return {
    orgId: value['orgId'],
    role,
    cabinetRole,
    cabinetId: optionalString(value['cabinetId']),
    accessSource: optionalString(value['accessSource']),
    displayName: optionalString(value['displayName']),
    workspaceType,
    status: value['status'] === 'ACTIVE' ? value['status'] : undefined,
    country: optionalString(value['country']) as WorkspaceSummary['country'],
    accountingFramework: optionalString(
      value['accountingFramework']
    ) as WorkspaceSummary['accountingFramework']
  };
}

function parseWorkspacesResponse(response: unknown): WorkspaceSummary[] {
  if (!isRecord(response) || !Array.isArray(response['workspaces'])) {
    throw new Error('Invalid workspace discovery response.');
  }

  return response['workspaces'].map(parseWorkspaceSummary);
}

@Injectable({ providedIn: 'root' })
export class WorkspacesApi {
  private readonly http = inject(HttpClient);
  private readonly apiBaseUrl = environment.apiBaseUrl.replace(/\/$/, '');

  async listWorkspaces(): Promise<WorkspaceSummary[]> {
    const response = await firstValueFrom(
      this.http.get<unknown>(`${this.apiBaseUrl}/me/workspaces`)
    );

    return parseWorkspacesResponse(response);
  }
}
