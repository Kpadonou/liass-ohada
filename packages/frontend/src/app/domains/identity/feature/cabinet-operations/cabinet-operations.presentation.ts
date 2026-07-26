import { HttpErrorResponse } from '@angular/common/http';
import type {
  AccountingWork,
  AccountingWorkStatus,
  AccountingWorkType,
  CabinetDeadline,
  CabinetDeadlineStatus,
  CabinetDeadlineType,
  CabinetPriority
} from '@liass-ohada/shared/shared';

import { backendErrorCode } from '../cabinet-team/cabinet-team.presentation';

export const ACCOUNTING_WORK_TYPES: readonly AccountingWorkType[] = [
  'ACCOUNTING_ENTRY',
  'BANK_RECONCILIATION',
  'ACCOUNT_REVIEW',
  'MONTHLY_CLOSE',
  'ANNUAL_CLOSE',
  'TAX_DECLARATION',
  'FINANCIAL_STATEMENTS',
  'OTHER'
];
export const ACCOUNTING_WORK_STATUSES: readonly AccountingWorkStatus[] = [
  'TO_PLAN',
  'TO_DO',
  'IN_PROGRESS',
  'WAITING',
  'COMPLETED',
  'CANCELLED'
];
export const CABINET_DEADLINE_TYPES: readonly CabinetDeadlineType[] = [
  'TAX',
  'ACCOUNTING',
  'REGULATORY',
  'CLIENT',
  'INTERNAL',
  'OTHER'
];
export const CABINET_DEADLINE_STATUSES: readonly CabinetDeadlineStatus[] = [
  'PENDING',
  'COMPLETED',
  'CANCELLED'
];
export const CABINET_PRIORITIES: readonly CabinetPriority[] = [
  'LOW',
  'NORMAL',
  'HIGH',
  'URGENT'
];

const WORK_STATUS_TRANSITIONS: Record<AccountingWorkStatus, readonly AccountingWorkStatus[]> = {
  CANCELLED: [],
  COMPLETED: [],
  IN_PROGRESS: ['WAITING', 'COMPLETED', 'CANCELLED'],
  TO_DO: ['IN_PROGRESS', 'WAITING', 'COMPLETED', 'CANCELLED'],
  TO_PLAN: ['TO_DO', 'IN_PROGRESS', 'CANCELLED'],
  WAITING: ['IN_PROGRESS', 'COMPLETED', 'CANCELLED']
};

export function allowedWorkTransitions(status: AccountingWorkStatus): readonly AccountingWorkStatus[] {
  return WORK_STATUS_TRANSITIONS[status];
}

export function allowedDeadlineTransitions(
  status: CabinetDeadlineStatus
): readonly CabinetDeadlineStatus[] {
  return status === 'PENDING' ? ['COMPLETED', 'CANCELLED'] : [];
}

export function workTypeKey(type: AccountingWorkType): string {
  return `IDENTITY.CABINET_OPERATIONS.WORK.TYPES.${type}`;
}

export function workStatusKey(status: AccountingWorkStatus): string {
  return `IDENTITY.CABINET_OPERATIONS.WORK.STATUS.${status}`;
}

export function deadlineTypeKey(type: CabinetDeadlineType): string {
  return `IDENTITY.CABINET_OPERATIONS.DEADLINE.TYPES.${type}`;
}

export function deadlineStatusKey(status: CabinetDeadlineStatus): string {
  return `IDENTITY.CABINET_OPERATIONS.DEADLINE.STATUS.${status}`;
}

export function priorityKey(priority: CabinetPriority): string {
  return `IDENTITY.CABINET_OPERATIONS.PRIORITY.${priority}`;
}

export function workTransitionKey(status: AccountingWorkStatus): string {
  return `IDENTITY.CABINET_OPERATIONS.WORK.TRANSITIONS.${status}`;
}

export function deadlineTransitionKey(status: CabinetDeadlineStatus): string {
  return `IDENTITY.CABINET_OPERATIONS.DEADLINE.TRANSITIONS.${status}`;
}

export function priorityTone(priority: CabinetPriority): 'neutral' | 'info' | 'warning' | 'danger' {
  if (priority === 'URGENT') return 'danger';
  if (priority === 'HIGH') return 'warning';
  if (priority === 'LOW') return 'neutral';
  return 'info';
}

export function workStatusTone(
  status: AccountingWorkStatus
): 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info' {
  if (status === 'COMPLETED') return 'success';
  if (status === 'CANCELLED') return 'danger';
  if (status === 'IN_PROGRESS') return 'brand';
  if (status === 'WAITING') return 'warning';
  return 'neutral';
}

export function deadlineStatusTone(
  status: CabinetDeadlineStatus
): 'neutral' | 'success' | 'danger' | 'warning' {
  if (status === 'COMPLETED') return 'success';
  if (status === 'CANCELLED') return 'danger';
  return 'warning';
}

export function isWorkOverdue(work: Pick<AccountingWork, 'dueDate' | 'status'>): boolean {
  return (
    !!work.dueDate &&
    work.dueDate < todayDateOnly() &&
    work.status !== 'COMPLETED' &&
    work.status !== 'CANCELLED'
  );
}

export function isDeadlineOverdue(deadline: Pick<CabinetDeadline, 'dueDate' | 'status'>): boolean {
  return deadline.dueDate < todayDateOnly() && deadline.status === 'PENDING';
}

export function todayDateOnly(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function userDisplayLabel(
  user: { displayName?: string; givenName?: string; familyName?: string; email?: string } | null | undefined,
  fallback: string
): string {
  const combined = [user?.givenName, user?.familyName].filter(Boolean).join(' ').trim();
  return user?.displayName?.trim() || combined || user?.email?.trim() || fallback;
}

const ERROR_KEYS: Record<string, string> = {
  CABINET_DEADLINE_DOSSIER_FORBIDDEN:
    'IDENTITY.CABINET_OPERATIONS.ERRORS.DEADLINE_DOSSIER_FORBIDDEN',
  CABINET_DEADLINE_LINKED_WORK_DOSSIER_MISMATCH:
    'IDENTITY.CABINET_OPERATIONS.ERRORS.DEADLINE_LINKED_WORK_DOSSIER_MISMATCH',
  CABINET_DEADLINE_NOT_FOUND: 'IDENTITY.CABINET_OPERATIONS.ERRORS.DEADLINE_NOT_FOUND',
  CABINET_DEADLINE_RESPONSIBLE_INVALID:
    'IDENTITY.CABINET_OPERATIONS.ERRORS.DEADLINE_RESPONSIBLE_INVALID',
  CABINET_DEADLINE_STATUS_TRANSITION_INVALID:
    'IDENTITY.CABINET_OPERATIONS.ERRORS.DEADLINE_STATUS_TRANSITION_INVALID',
  CABINET_DEADLINE_STATUS_UPDATE_FORBIDDEN:
    'IDENTITY.CABINET_OPERATIONS.ERRORS.DEADLINE_STATUS_UPDATE_FORBIDDEN',
  CABINET_WORK_ASSIGNEE_INVALID: 'IDENTITY.CABINET_OPERATIONS.ERRORS.WORK_ASSIGNEE_INVALID',
  CABINET_WORK_DATE_RANGE_INVALID: 'IDENTITY.CABINET_OPERATIONS.ERRORS.WORK_DATE_RANGE_INVALID',
  CABINET_WORK_DOSSIER_FORBIDDEN:
    'IDENTITY.CABINET_OPERATIONS.ERRORS.WORK_DOSSIER_FORBIDDEN',
  CABINET_WORK_NOT_FOUND: 'IDENTITY.CABINET_OPERATIONS.ERRORS.WORK_NOT_FOUND',
  CABINET_WORK_PARTICIPANT_INVALID:
    'IDENTITY.CABINET_OPERATIONS.ERRORS.WORK_PARTICIPANT_INVALID',
  CABINET_WORK_READER_NOT_ASSIGNABLE:
    'IDENTITY.CABINET_OPERATIONS.ERRORS.WORK_READER_NOT_ASSIGNABLE',
  CABINET_WORK_STATUS_TRANSITION_INVALID:
    'IDENTITY.CABINET_OPERATIONS.ERRORS.WORK_STATUS_TRANSITION_INVALID',
  CABINET_WORK_STATUS_UPDATE_FORBIDDEN:
    'IDENTITY.CABINET_OPERATIONS.ERRORS.WORK_STATUS_UPDATE_FORBIDDEN'
};

export function cabinetOperationsErrorKey(error: unknown, fallback: string): string {
  const code = backendErrorCode(error);
  if (code && ERROR_KEYS[code]) {
    return ERROR_KEYS[code];
  }
  if (error instanceof HttpErrorResponse && error.status === 409) {
    return 'IDENTITY.CABINET_OPERATIONS.ERRORS.STALE_STATE';
  }
  return fallback;
}
