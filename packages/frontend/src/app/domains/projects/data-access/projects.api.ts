import { HttpClient } from '@angular/common/http';
import { HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import {
  BudgetLineResponseSchema,
  CreateBudgetLineRequestSchema,
  CreateDonorRequestSchema,
  CreateFundingSourceRequestSchema,
  CreateProjectRequestSchema,
  DonorResponseSchema,
  FundingSourceResponseSchema,
  ListBudgetLinesResponseSchema,
  ListDonorsResponseSchema,
  ListFundingSourcesResponseSchema,
  ListProjectsResponseSchema,
  FundingSourceDtoSchema,
  ProjectDtoSchema,
  ProjectReportResponseSchema,
  ProjectResponseSchema,
  ProjectsSummaryResponseSchema,
  type BudgetLineDto,
  type CreateBudgetLineRequest,
  type CreateDonorRequest,
  type CreateFundingSourceRequest,
  type CreateProjectRequest,
  type DonorDto,
  type FundingSourceDto,
  type ProjectDto,
  type ProjectReportDto,
  type ProjectSummaryDto
} from '@liass-ohada/shared/projects';
import { firstValueFrom } from 'rxjs';
import { z } from 'zod';

import { environment } from '../../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class ProjectsApi {
  private readonly http = inject(HttpClient);
  private readonly apiBaseUrl = environment.apiBaseUrl.replace(/\/$/, '');

  async listProjects(): Promise<ProjectDto[]> {
    const response = await firstValueFrom(
      this.http.get<unknown>(`${this.apiBaseUrl}/projects`)
    );
    const parsed = ListProjectsCompatSchema.parse(response);

    return parsed.data.projects;
  }

  async getProject(projectId: string): Promise<ProjectDto> {
    const response = await firstValueFrom(
      this.http.get<unknown>(`${this.apiBaseUrl}/projects/${encodeURIComponent(projectId)}`)
    );
    const parsed = ProjectResponseCompatSchema.parse(response);

    return parsed.data;
  }

  async createProject(payload: CreateProjectRequest): Promise<ProjectDto> {
    const request = CreateProjectRequestSchema.parse(payload);
    const response = await firstValueFrom(
      this.http.post<unknown>(`${this.apiBaseUrl}/projects`, request)
    );

    return ProjectResponseSchema.parse(response).data;
  }

  async listDonors(): Promise<DonorDto[]> {
    const response = await firstValueFrom(
      this.http.get<unknown>(`${this.apiBaseUrl}/donors`)
    );

    return ListDonorsResponseSchema.parse(response).data.donors;
  }

  async createDonor(payload: CreateDonorRequest): Promise<DonorDto> {
    const request = CreateDonorRequestSchema.parse(payload);
    const response = await firstValueFrom(
      this.http.post<unknown>(`${this.apiBaseUrl}/donors`, request)
    );

    return DonorResponseSchema.parse(response).data;
  }

  async listFundingSources(projectId: string): Promise<FundingSourceDto[]> {
    const response = await firstValueFrom(
      this.http.get<unknown>(
        `${this.apiBaseUrl}/projects/${encodeURIComponent(projectId)}/funding-sources`
      )
    );
    const parsed = ListFundingSourcesCompatSchema.parse(response);

    return parsed.data.fundingSources;
  }

  async createFundingSource(
    projectId: string,
    payload: CreateFundingSourceRequest
  ): Promise<FundingSourceDto> {
    const request = CreateFundingSourceRequestSchema.parse(payload);
    const response = await firstValueFrom(
      this.http.post<unknown>(
        `${this.apiBaseUrl}/projects/${encodeURIComponent(projectId)}/funding-sources`,
        request
      )
    );

    return FundingSourceResponseSchema.parse(response).data;
  }

  async listBudgetLines(projectId: string, year: string): Promise<BudgetLineDto[]> {
    const response = await firstValueFrom(
      this.http.get<unknown>(
        `${this.apiBaseUrl}/projects/${encodeURIComponent(projectId)}/budget-lines`,
        { params: new HttpParams().set('year', year) }
      )
    );

    return ListBudgetLinesResponseSchema.parse(response).data.budgetLines;
  }

  async createBudgetLine(
    projectId: string,
    payload: CreateBudgetLineRequest
  ): Promise<BudgetLineDto> {
    const request = CreateBudgetLineRequestSchema.parse(payload);
    const response = await firstValueFrom(
      this.http.post<unknown>(
        `${this.apiBaseUrl}/projects/${encodeURIComponent(projectId)}/budget-lines`,
        request
      )
    );

    return BudgetLineResponseSchema.parse(response).data;
  }

  async getProjectReport(projectId: string, year: string): Promise<ProjectReportDto> {
    const response = await firstValueFrom(
      this.http.get<unknown>(
        `${this.apiBaseUrl}/projects/${encodeURIComponent(projectId)}/report`,
        { params: new HttpParams().set('year', year) }
      )
    );

    return ProjectReportResponseSchema.parse(response).data;
  }

  async getProjectsSummary(year: string): Promise<ProjectSummaryDto[]> {
    const response = await firstValueFrom(
      this.http.get<unknown>(`${this.apiBaseUrl}/projects/summary`, {
        params: new HttpParams().set('year', year)
      })
    );

    return ProjectsSummaryResponseSchema.parse(response).data;
  }
}

const ListProjectsCompatSchema = z.union([
  ListProjectsResponseSchema,
  z.object({
    message: z.unknown().optional(),
    projects: z.array(ProjectDtoSchema)
  }).transform((value) => ({
    message: value.message,
    data: {
      projects: value.projects
    }
  }))
]);

const ProjectResponseCompatSchema = z.union([
  ProjectResponseSchema,
  z.object({
    message: z.unknown().optional(),
    project: ProjectResponseSchema.shape.data
  }).transform((value) => ({
    message: value.message,
    data: value.project
  }))
]);

const ListFundingSourcesCompatSchema = z.union([
  ListFundingSourcesResponseSchema,
  z.object({
    message: z.unknown().optional(),
    fundingSources: z.array(FundingSourceDtoSchema)
  }).transform((value) => ({
    message: value.message,
    data: {
      fundingSources: value.fundingSources
    }
  }))
]);
