import { Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import type {
  AccountingWorkSummary,
  CabinetDeadline,
  CabinetDeadlineType,
  CabinetDossierSummary,
  CabinetMemberSummary,
  CabinetPriority,
  CreateCabinetDeadlineRequest,
  UpdateCabinetDeadlineRequest
} from '@liass-ohada/shared/shared';
import { TranslocoModule, TranslocoService } from '@ngneat/transloco';

import { LiassButtonComponent } from '../../../../shared/ui/button/button.component';
import { LiassStatusChipComponent } from '../../../../shared/ui/status-chip/status-chip.component';
import {
  CABINET_DEADLINE_TYPES,
  CABINET_PRIORITIES,
  deadlineStatusKey,
  deadlineStatusTone,
  deadlineTypeKey,
  priorityKey,
  priorityTone,
  userDisplayLabel
} from './cabinet-operations.presentation';

export interface CabinetDeadlineDialogData {
  deadline?: CabinetDeadline;
  dossiers: readonly CabinetDossierSummary[];
  members: readonly CabinetMemberSummary[];
  mode: 'create' | 'edit' | 'view';
  works: readonly AccountingWorkSummary[];
}

export type CabinetDeadlineDialogResult =
  | { mode: 'create'; payload: CreateCabinetDeadlineRequest }
  | { mode: 'edit'; payload: UpdateCabinetDeadlineRequest }
  | null;

@Component({
  selector: 'liass-cabinet-deadline-dialog',
  imports: [
    LiassButtonComponent,
    LiassStatusChipComponent,
    MatDialogModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    ReactiveFormsModule,
    TranslocoModule
  ],
  template: `
    <div class="flex max-h-[calc(100vh-32px)] flex-col">
      <div class="border-b border-slate-100 px-6 py-5 dark:border-slate-800">
        <p class="text-xs font-semibold uppercase tracking-[0.14em] text-brand-700 dark:text-brand-300">
          {{ 'IDENTITY.CABINET_OPERATIONS.DEADLINE.PAGE_TITLE' | transloco }}
        </p>
        <h2 class="mt-1 text-xl font-semibold text-slate-950 dark:text-white" mat-dialog-title>
          {{ titleKey() | transloco }}
        </h2>
      </div>

      @if (readonly()) {
        <div class="space-y-5 overflow-y-auto px-6 py-5">
          <div>
            <p class="text-lg font-semibold text-slate-950 dark:text-white">{{ data.deadline?.title }}</p>
            @if (data.deadline?.description) {
              <p class="mt-2 whitespace-pre-line text-sm leading-6 text-slate-600 dark:text-slate-400">
                {{ data.deadline?.description }}
              </p>
            }
          </div>
          <div class="grid gap-4 sm:grid-cols-2">
            <div>
              <p class="detail-label">{{ 'IDENTITY.CABINET_OPERATIONS.FIELDS.DOSSIER' | transloco }}</p>
              <p class="detail-value">{{ dossierName(data.deadline?.dossierOrgId) }}</p>
            </div>
            <div>
              <p class="detail-label">{{ 'IDENTITY.CABINET_OPERATIONS.FIELDS.TYPE' | transloco }}</p>
              <p class="detail-value">{{ typeLabel(data.deadline?.type) }}</p>
            </div>
            <div>
              <p class="detail-label">{{ 'IDENTITY.CABINET_OPERATIONS.FIELDS.DUE_DATE' | transloco }}</p>
              <p class="detail-value">{{ dateLabel(data.deadline?.dueDate) }}</p>
            </div>
            <div>
              <p class="detail-label">{{ 'IDENTITY.CABINET_OPERATIONS.FIELDS.RESPONSIBLE' | transloco }}</p>
              <p class="detail-value">{{ memberName(data.deadline?.responsibleUserId, data.deadline?.responsibleDisplayName) }}</p>
            </div>
            <div class="sm:col-span-2">
              <p class="detail-label">{{ 'IDENTITY.CABINET_OPERATIONS.FIELDS.LINKED_WORK' | transloco }}</p>
              <p class="detail-value">{{ linkedWorkLabel(data.deadline?.linkedWorkId) }}</p>
            </div>
          </div>
          <div class="flex flex-wrap gap-2">
            @if (data.deadline) {
              <liass-status-chip [label]="priorityLabel(data.deadline.priority)" [tone]="priorityTone(data.deadline.priority)" size="sm" />
              <liass-status-chip [label]="statusLabel(data.deadline.status)" [tone]="deadlineStatusTone(data.deadline.status)" size="sm" />
            }
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
                @for (type of deadlineTypes; track type) {
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

          <mat-form-field appearance="outline" class="w-full">
            <mat-label>{{ 'IDENTITY.CABINET_OPERATIONS.FIELDS.DUE_DATE' | transloco }}</mat-label>
            <input matInput type="date" formControlName="dueDate" />
            @if (form.controls.dueDate.invalid && form.controls.dueDate.touched) {
              <mat-error>{{ 'IDENTITY.CABINET_OPERATIONS.VALIDATION.DUE_DATE_REQUIRED' | transloco }}</mat-error>
            }
          </mat-form-field>

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
            <mat-label>{{ 'IDENTITY.CABINET_OPERATIONS.FIELDS.LINKED_WORK' | transloco }}</mat-label>
            <mat-select formControlName="linkedWorkId">
              <mat-option value="">{{ 'IDENTITY.CABINET_OPERATIONS.NONE' | transloco }}</mat-option>
              @for (work of linkedWorkOptions(); track work.workId) {
                <mat-option [value]="work.workId">{{ work.title }} · {{ dateLabel(work.dueDate) }}</mat-option>
              }
            </mat-select>
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
  `,
  styles: [
    `
      .detail-label {
        font-size: 0.75rem;
        font-weight: 700;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: rgb(100 116 139);
      }
      .detail-value {
        margin-top: 0.25rem;
        font-size: 0.875rem;
        color: rgb(51 65 85);
      }
      :host-context(.dark) .detail-value {
        color: rgb(203 213 225);
      }
    `
  ]
})
export class CabinetDeadlineDialogComponent {
  protected readonly data = inject<CabinetDeadlineDialogData>(MAT_DIALOG_DATA);
  private readonly dialogRef =
    inject<MatDialogRef<CabinetDeadlineDialogComponent, CabinetDeadlineDialogResult>>(
      MatDialogRef
    );
  private readonly formBuilder = inject(FormBuilder);
  private readonly transloco = inject(TranslocoService);

  protected readonly deadlineTypes = CABINET_DEADLINE_TYPES;
  protected readonly priorities = CABINET_PRIORITIES;
  protected readonly priorityTone = priorityTone;
  protected readonly deadlineStatusTone = deadlineStatusTone;
  protected readonly submitting = signal(false);
  protected readonly readonly = computed(() => this.data.mode === 'view');
  protected readonly isEditMode = computed(() => this.data.mode === 'edit');
  protected readonly titleKey = computed(() =>
    this.data.mode === 'create'
      ? 'IDENTITY.CABINET_OPERATIONS.DEADLINE.CREATE_TITLE'
      : this.data.mode === 'edit'
        ? 'IDENTITY.CABINET_OPERATIONS.DEADLINE.EDIT_TITLE'
        : 'IDENTITY.CABINET_OPERATIONS.DEADLINE.DETAIL_TITLE'
  );

  protected readonly form = this.formBuilder.nonNullable.group({
    description: [this.data.deadline?.description ?? ''],
    dossierOrgId: [this.data.deadline?.dossierOrgId ?? '', [Validators.required]],
    dueDate: [this.data.deadline?.dueDate ?? '', [Validators.required]],
    linkedWorkId: [this.data.deadline?.linkedWorkId ?? ''],
    priority: [this.data.deadline?.priority ?? 'NORMAL' as CabinetPriority, [Validators.required]],
    responsibleUserId: [this.data.deadline?.responsibleUserId ?? ''],
    title: [this.data.deadline?.title ?? '', [Validators.required, Validators.maxLength(160)]],
    type: [this.data.deadline?.type ?? 'OTHER' as CabinetDeadlineType, [Validators.required]]
  });

  protected readonly eligibleMembers = computed(() =>
    this.data.members.filter(
      (member) =>
        member.status === 'ACTIVE' &&
        (member.cabinetRole === 'CABINET_ADMIN' ||
          member.cabinetRole === 'SUPERVISOR' ||
          member.cabinetRole === 'COLLABORATOR')
    )
  );

  protected readonly linkedWorkOptions = computed(() => {
    const dossierOrgId = this.form.controls.dossierOrgId.value;
    return this.data.works.filter((work) => work.dossierOrgId === dossierOrgId);
  });

  protected submit(): void {
    if (this.form.invalid || this.submitting()) {
      this.form.markAllAsTouched();
      return;
    }
    const raw = this.form.getRawValue();
    const common = {
      description: optional(raw.description),
      dueDate: raw.dueDate,
      linkedWorkId: optional(raw.linkedWorkId),
      priority: raw.priority,
      responsibleUserId: optional(raw.responsibleUserId),
      title: raw.title.trim(),
      type: raw.type
    };
    this.dialogRef.close(
      this.data.mode === 'edit' && this.data.deadline
        ? { mode: 'edit', payload: { ...common, deadlineId: this.data.deadline.deadlineId } }
        : { mode: 'create', payload: { ...common, dossierOrgId: raw.dossierOrgId } }
    );
  }

  protected cancel(): void {
    this.dialogRef.close(null);
  }

  protected dateLabel(value: string | undefined): string {
    return value
      ? new Intl.DateTimeFormat(this.transloco.getActiveLang()).format(new Date(`${value}T00:00:00`))
      : this.transloco.translate('IDENTITY.CABINET_OPERATIONS.NONE');
  }

  protected dossierName(dossierOrgId: string | undefined): string {
    return (
      this.data.dossiers.find((dossier) => dossier.orgId === dossierOrgId)?.displayName ??
      this.data.deadline?.dossierName ??
      this.transloco.translate('IDENTITY.CABINET_OPERATIONS.NONE')
    );
  }

  protected linkedWorkLabel(workId: string | undefined): string {
    if (!workId) {
      return this.transloco.translate('IDENTITY.CABINET_OPERATIONS.NONE');
    }
    return (
      this.data.works.find((work) => work.workId === workId)?.title ??
      this.transloco.translate('IDENTITY.CABINET_OPERATIONS.LINKED_WORK_AVAILABLE')
    );
  }

  protected memberName(userId: string | undefined, displayName?: string): string {
    const member = this.data.members.find((candidate) => candidate.userId === userId);
    const fallbackKey = userId
      ? 'IDENTITY.CABINET_OPERATIONS.ASSIGNED_MEMBER'
      : 'IDENTITY.CABINET_OPERATIONS.UNASSIGNED';
    return displayName?.trim() || userDisplayLabel(member, this.transloco.translate(fallbackKey));
  }

  protected priorityLabel(priority: CabinetPriority): string {
    return this.transloco.translate(priorityKey(priority));
  }

  protected statusLabel(status: CabinetDeadline['status']): string {
    return this.transloco.translate(deadlineStatusKey(status));
  }

  protected typeLabel(type: CabinetDeadlineType | undefined): string {
    return type
      ? this.transloco.translate(deadlineTypeKey(type))
      : this.transloco.translate('IDENTITY.CABINET_OPERATIONS.NONE');
  }
}

function optional(value: string): string | undefined {
  return value.trim() || undefined;
}
