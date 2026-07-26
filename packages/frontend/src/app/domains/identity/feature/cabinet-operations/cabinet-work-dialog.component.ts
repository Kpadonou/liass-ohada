import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import type {
  AccountingWork,
  AccountingWorkType,
  CabinetDossierSummary,
  CabinetMemberSummary,
  CabinetPriority,
  CreateAccountingWorkRequest,
  UpdateAccountingWorkRequest
} from '@liass-ohada/shared/shared';
import { TranslocoModule, TranslocoService } from '@ngneat/transloco';

import { LiassButtonComponent } from '../../../../shared/ui/button/button.component';
import { LiassStatusChipComponent } from '../../../../shared/ui/status-chip/status-chip.component';
import {
  ACCOUNTING_WORK_TYPES,
  CABINET_PRIORITIES,
  priorityKey,
  priorityTone,
  userDisplayLabel,
  workStatusKey,
  workStatusTone,
  workTypeKey
} from './cabinet-operations.presentation';

export interface CabinetWorkDialogData {
  dossiers: readonly CabinetDossierSummary[];
  members: readonly CabinetMemberSummary[];
  mode: 'create' | 'edit' | 'view';
  work?: AccountingWork;
}

export type CabinetWorkDialogResult =
  | { mode: 'create'; payload: CreateAccountingWorkRequest }
  | { mode: 'edit'; payload: UpdateAccountingWorkRequest }
  | null;

@Component({
  selector: 'liass-cabinet-work-dialog',
  imports: [
    LiassButtonComponent,
    LiassStatusChipComponent,
    NgTemplateOutlet,
    MatDialogModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressSpinnerModule,
    MatSelectModule,
    ReactiveFormsModule,
    TranslocoModule
  ],
  template: `
    <div class="flex max-h-[calc(100vh-32px)] flex-col">
      <div class="border-b border-slate-100 px-6 py-5 dark:border-slate-800">
        <p class="text-xs font-semibold uppercase tracking-[0.14em] text-brand-700 dark:text-brand-300">
          {{ 'IDENTITY.CABINET_OPERATIONS.WORK.PAGE_TITLE' | transloco }}
        </p>
        <h2 class="mt-1 text-xl font-semibold text-slate-950 dark:text-white" mat-dialog-title>
          {{ titleKey() | transloco }}
        </h2>
      </div>

      @if (readonly()) {
        <div class="space-y-5 overflow-y-auto px-6 py-5">
          <div>
            <p class="text-lg font-semibold text-slate-950 dark:text-white">{{ data.work?.title }}</p>
            @if (data.work?.description) {
              <p class="mt-2 whitespace-pre-line text-sm leading-6 text-slate-600 dark:text-slate-400">
                {{ data.work?.description }}
              </p>
            }
          </div>
          <div class="grid gap-4 sm:grid-cols-2">
            <ng-container *ngTemplateOutlet="detail; context: { label: 'IDENTITY.CABINET_OPERATIONS.FIELDS.DOSSIER', value: dossierName(data.work?.dossierOrgId) }" />
            <ng-container *ngTemplateOutlet="detail; context: { label: 'IDENTITY.CABINET_OPERATIONS.FIELDS.TYPE', value: typeLabel(data.work?.type) }" />
            <ng-container *ngTemplateOutlet="detail; context: { label: 'IDENTITY.CABINET_OPERATIONS.FIELDS.PERIOD', value: periodLabel(data.work) }" />
            <ng-container *ngTemplateOutlet="detail; context: { label: 'IDENTITY.CABINET_OPERATIONS.FIELDS.START_DATE', value: dateLabel(data.work?.startDate) }" />
            <ng-container *ngTemplateOutlet="detail; context: { label: 'IDENTITY.CABINET_OPERATIONS.FIELDS.DUE_DATE', value: dateLabel(data.work?.dueDate) }" />
            <ng-container *ngTemplateOutlet="detail; context: { label: 'IDENTITY.CABINET_OPERATIONS.FIELDS.RESPONSIBLE', value: memberName(data.work?.responsibleUserId, data.work?.responsibleDisplayName) }" />
          </div>
          <div class="flex flex-wrap gap-2">
            @if (data.work) {
              <liass-status-chip [label]="priorityLabel(data.work.priority)" [tone]="priorityTone(data.work.priority)" size="sm" />
              <liass-status-chip [label]="statusLabel(data.work.status)" [tone]="workStatusTone(data.work.status)" size="sm" />
            }
          </div>
          <div>
            <p class="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400">
              {{ 'IDENTITY.CABINET_OPERATIONS.FIELDS.PARTICIPANTS' | transloco }}
            </p>
            <p class="mt-1 text-sm text-slate-700 dark:text-slate-300">
              {{ participantNames(data.work?.participantUserIds ?? []) }}
            </p>
          </div>
        </div>
      } @else {
        <form class="space-y-4 overflow-y-auto px-6 py-5" [formGroup]="form" (ngSubmit)="submit()">
          <mat-form-field appearance="outline" class="w-full">
            <mat-label>{{ 'IDENTITY.CABINET_OPERATIONS.FIELDS.DOSSIER' | transloco }}</mat-label>
            <mat-select formControlName="dossierOrgId" [disabled]="isEditMode()">
              @for (dossier of data.dossiers; track dossier.orgId) {
                <mat-option [value]="dossier.orgId">{{ dossier.displayName }}</mat-option>
              }
            </mat-select>
            @if (form.controls.dossierOrgId.invalid && form.controls.dossierOrgId.touched) {
              <mat-error>{{ 'IDENTITY.CABINET_OPERATIONS.VALIDATION.DOSSIER_REQUIRED' | transloco }}</mat-error>
            }
          </mat-form-field>

          <div class="grid gap-4 sm:grid-cols-2">
            <mat-form-field appearance="outline">
              <mat-label>{{ 'IDENTITY.CABINET_OPERATIONS.FIELDS.TYPE' | transloco }}</mat-label>
              <mat-select formControlName="type">
                @for (type of workTypes; track type) {
                  <mat-option [value]="type">{{ typeLabel(type) }}</mat-option>
                }
              </mat-select>
            </mat-form-field>
            <mat-form-field appearance="outline">
              <mat-label>{{ 'IDENTITY.CABINET_OPERATIONS.FIELDS.PRIORITY' | transloco }}</mat-label>
              <mat-select formControlName="priority">
                @for (priority of priorities; track priority) {
                  <mat-option [value]="priority">{{ priorityLabel(priority) }}</mat-option>
                }
              </mat-select>
            </mat-form-field>
          </div>

          <mat-form-field appearance="outline" class="w-full">
            <mat-label>{{ 'IDENTITY.CABINET_OPERATIONS.FIELDS.TITLE' | transloco }}</mat-label>
            <input matInput formControlName="title" maxlength="160" />
            @if (form.controls.title.invalid && form.controls.title.touched) {
              <mat-error>{{ 'IDENTITY.CABINET_OPERATIONS.VALIDATION.TITLE_REQUIRED' | transloco }}</mat-error>
            }
          </mat-form-field>

          <mat-form-field appearance="outline" class="w-full">
            <mat-label>{{ 'IDENTITY.CABINET_OPERATIONS.FIELDS.DESCRIPTION' | transloco }}</mat-label>
            <textarea matInput rows="3" formControlName="description" maxlength="4000"></textarea>
          </mat-form-field>

          <div class="grid gap-4 sm:grid-cols-2">
            <mat-form-field appearance="outline">
              <mat-label>{{ 'IDENTITY.CABINET_OPERATIONS.FIELDS.PERIOD_START' | transloco }}</mat-label>
              <input matInput type="date" formControlName="periodStart" />
            </mat-form-field>
            <mat-form-field appearance="outline">
              <mat-label>{{ 'IDENTITY.CABINET_OPERATIONS.FIELDS.PERIOD_END' | transloco }}</mat-label>
              <input matInput type="date" formControlName="periodEnd" />
              @if (form.hasError('periodRange') && form.controls.periodEnd.touched) {
                <mat-error>{{ 'IDENTITY.CABINET_OPERATIONS.VALIDATION.PERIOD_RANGE' | transloco }}</mat-error>
              }
            </mat-form-field>
            <mat-form-field appearance="outline">
              <mat-label>{{ 'IDENTITY.CABINET_OPERATIONS.FIELDS.START_DATE' | transloco }}</mat-label>
              <input matInput type="date" formControlName="startDate" />
            </mat-form-field>
            <mat-form-field appearance="outline">
              <mat-label>{{ 'IDENTITY.CABINET_OPERATIONS.FIELDS.DUE_DATE' | transloco }}</mat-label>
              <input matInput type="date" formControlName="dueDate" />
              @if (form.hasError('workDateRange') && form.controls.dueDate.touched) {
                <mat-error>{{ 'IDENTITY.CABINET_OPERATIONS.VALIDATION.DATE_RANGE' | transloco }}</mat-error>
              }
            </mat-form-field>
          </div>

          <mat-form-field appearance="outline" class="w-full">
            <mat-label>{{ 'IDENTITY.CABINET_OPERATIONS.FIELDS.RESPONSIBLE' | transloco }}</mat-label>
            <mat-select formControlName="responsibleUserId">
              <mat-option value="">{{ 'IDENTITY.CABINET_OPERATIONS.UNASSIGNED' | transloco }}</mat-option>
              @for (member of eligibleMembers(); track member.userId) {
                <mat-option [value]="member.userId">{{ memberName(member.userId, member.displayName) }}</mat-option>
              }
            </mat-select>
          </mat-form-field>

          <mat-form-field appearance="outline" class="w-full">
            <mat-label>{{ 'IDENTITY.CABINET_OPERATIONS.FIELDS.PARTICIPANTS' | transloco }}</mat-label>
            <mat-select formControlName="participantUserIds" multiple>
              @for (member of participantOptions(); track member.userId) {
                <mat-option [value]="member.userId">{{ memberName(member.userId, member.displayName) }}</mat-option>
              }
            </mat-select>
            <mat-hint>{{ 'IDENTITY.CABINET_OPERATIONS.FIELDS.SELECTED_COUNT' | transloco: { count: form.controls.participantUserIds.value.length } }}</mat-hint>
          </mat-form-field>
        </form>
      }

      <div class="flex justify-end gap-2 border-t border-slate-100 px-6 py-4 dark:border-slate-800" mat-dialog-actions>
        <liass-button variant="ghost" tone="neutral" [disabled]="submitting()" (pressed)="cancel()">
          {{ (readonly() ? 'IDENTITY.CABINET_OPERATIONS.ACTIONS.CLOSE' : 'IDENTITY.CABINET_OPERATIONS.ACTIONS.CANCEL') | transloco }}
        </liass-button>
        @if (!readonly()) {
          <liass-button tone="brand" variant="solid" [loading]="submitting()" (pressed)="submit()">
            {{ (isEditMode() ? 'IDENTITY.CABINET_OPERATIONS.ACTIONS.SAVE' : 'IDENTITY.CABINET_OPERATIONS.ACTIONS.CREATE') | transloco }}
          </liass-button>
        }
      </div>
    </div>

    <ng-template #detail let-label="label" let-value="value">
      <div>
        <p class="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400">
          {{ label | transloco }}
        </p>
        <p class="mt-1 text-sm text-slate-700 dark:text-slate-300">{{ value }}</p>
      </div>
    </ng-template>
  `
})
export class CabinetWorkDialogComponent {
  protected readonly data = inject<CabinetWorkDialogData>(MAT_DIALOG_DATA);
  private readonly dialogRef =
    inject<MatDialogRef<CabinetWorkDialogComponent, CabinetWorkDialogResult>>(MatDialogRef);
  private readonly formBuilder = inject(FormBuilder);
  private readonly transloco = inject(TranslocoService);

  protected readonly priorities = CABINET_PRIORITIES;
  protected readonly submitting = signal(false);
  protected readonly workTypes = ACCOUNTING_WORK_TYPES;
  protected readonly priorityTone = priorityTone;
  protected readonly workStatusTone = workStatusTone;
  protected readonly readonly = computed(() => this.data.mode === 'view');
  protected readonly isEditMode = computed(() => this.data.mode === 'edit');
  protected readonly titleKey = computed(() =>
    this.data.mode === 'create'
      ? 'IDENTITY.CABINET_OPERATIONS.WORK.CREATE_TITLE'
      : this.data.mode === 'edit'
        ? 'IDENTITY.CABINET_OPERATIONS.WORK.EDIT_TITLE'
        : 'IDENTITY.CABINET_OPERATIONS.WORK.DETAIL_TITLE'
  );

  protected readonly form = this.formBuilder.nonNullable.group(
    {
      description: [this.data.work?.description ?? ''],
      dossierOrgId: [this.data.work?.dossierOrgId ?? '', [Validators.required]],
      dueDate: [this.data.work?.dueDate ?? ''],
      participantUserIds: [this.data.work?.participantUserIds ?? []],
      periodEnd: [this.data.work?.periodEnd ?? ''],
      periodStart: [this.data.work?.periodStart ?? ''],
      priority: [this.data.work?.priority ?? 'NORMAL' as CabinetPriority, [Validators.required]],
      responsibleUserId: [this.data.work?.responsibleUserId ?? ''],
      startDate: [this.data.work?.startDate ?? ''],
      title: [this.data.work?.title ?? '', [Validators.required, Validators.maxLength(160)]],
      type: [this.data.work?.type ?? 'OTHER' as AccountingWorkType, [Validators.required]]
    },
    { validators: [workDateValidator] }
  );

  protected readonly eligibleMembers = computed(() =>
    this.data.members.filter(
      (member) =>
        member.status === 'ACTIVE' &&
        (member.cabinetRole === 'CABINET_ADMIN' ||
          member.cabinetRole === 'SUPERVISOR' ||
          member.cabinetRole === 'COLLABORATOR')
    )
  );

  protected readonly participantOptions = computed(() => {
    const responsibleUserId = this.form.controls.responsibleUserId.value;
    return this.eligibleMembers().filter((member) => member.userId !== responsibleUserId);
  });

  protected submit(): void {
    this.form.controls.participantUserIds.setValue([...new Set(this.form.controls.participantUserIds.value)]);
    if (this.form.invalid || this.submitting()) {
      this.form.markAllAsTouched();
      return;
    }
    const raw = this.form.getRawValue();
    const common = {
      description: optional(raw.description),
      dueDate: optional(raw.dueDate),
      participantUserIds: raw.participantUserIds,
      periodEnd: optional(raw.periodEnd),
      periodStart: optional(raw.periodStart),
      priority: raw.priority,
      responsibleUserId: optional(raw.responsibleUserId),
      startDate: optional(raw.startDate),
      title: raw.title.trim(),
      type: raw.type
    };
    this.dialogRef.close(
      this.data.mode === 'edit' && this.data.work
        ? { mode: 'edit', payload: { ...common, workId: this.data.work.workId } }
        : { mode: 'create', payload: { ...common, dossierOrgId: raw.dossierOrgId } }
    );
  }

  protected cancel(): void {
    this.dialogRef.close(null);
  }

  protected dateLabel(value: string | undefined): string {
    return value ? new Intl.DateTimeFormat(this.transloco.getActiveLang()).format(new Date(`${value}T00:00:00`)) : this.transloco.translate('IDENTITY.CABINET_OPERATIONS.NONE');
  }

  protected dossierName(dossierOrgId: string | undefined): string {
    return (
      this.data.dossiers.find((dossier) => dossier.orgId === dossierOrgId)?.displayName ??
      this.data.work?.dossierName ??
      this.transloco.translate('IDENTITY.CABINET_OPERATIONS.NONE')
    );
  }

  protected memberName(userId: string | undefined, displayName?: string): string {
    const member = this.data.members.find((candidate) => candidate.userId === userId);
    const fallbackKey = userId
      ? 'IDENTITY.CABINET_OPERATIONS.ASSIGNED_MEMBER'
      : 'IDENTITY.CABINET_OPERATIONS.UNASSIGNED';
    return displayName?.trim() || userDisplayLabel(member, this.transloco.translate(fallbackKey));
  }

  protected participantNames(userIds: readonly string[]): string {
    if (!userIds.length) {
      return this.transloco.translate('IDENTITY.CABINET_OPERATIONS.NONE');
    }
    return userIds.map((userId) => this.memberName(userId)).join(', ');
  }

  protected periodLabel(work: AccountingWork | undefined): string {
    if (!work?.periodStart && !work?.periodEnd) {
      return this.transloco.translate('IDENTITY.CABINET_OPERATIONS.NONE');
    }
    return [work.periodStart, work.periodEnd].filter(Boolean).map((date) => this.dateLabel(date)).join(' - ');
  }

  protected priorityLabel(priority: CabinetPriority): string {
    return this.transloco.translate(priorityKey(priority));
  }

  protected statusLabel(status: AccountingWork['status']): string {
    return this.transloco.translate(workStatusKey(status));
  }

  protected typeLabel(type: AccountingWorkType | undefined): string {
    return type ? this.transloco.translate(workTypeKey(type)) : this.transloco.translate('IDENTITY.CABINET_OPERATIONS.NONE');
  }
}

function optional(value: string): string | undefined {
  return value.trim() || undefined;
}

function workDateValidator(group: { get: (name: string) => { value: string } | null }) {
  const periodStart = group.get('periodStart')?.value;
  const periodEnd = group.get('periodEnd')?.value;
  const startDate = group.get('startDate')?.value;
  const dueDate = group.get('dueDate')?.value;
  return {
    ...(periodStart && periodEnd && periodStart > periodEnd ? { periodRange: true } : {}),
    ...(startDate && dueDate && startDate > dueDate ? { workDateRange: true } : {})
  };
}
