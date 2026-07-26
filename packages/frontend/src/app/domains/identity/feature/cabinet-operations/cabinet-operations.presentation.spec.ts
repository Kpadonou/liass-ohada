import {
  allowedDeadlineTransitions,
  allowedWorkTransitions,
  isDeadlineOverdue,
  isWorkOverdue,
  todayDateOnly
} from './cabinet-operations.presentation';

describe('cabinet operations presentation helpers', () => {
  it('derives Work overdue state without changing final statuses', () => {
    const yesterday = '2026-07-25';
    expect(todayDateOnly(new Date('2026-07-26T12:00:00'))).toBe('2026-07-26');
    expect(isWorkOverdue({ dueDate: yesterday, status: 'TO_DO' })).toBe(true);
    expect(isWorkOverdue({ dueDate: yesterday, status: 'COMPLETED' })).toBe(false);
    expect(isWorkOverdue({ dueDate: yesterday, status: 'CANCELLED' })).toBe(false);
  });

  it('derives Deadline overdue only for pending deadlines', () => {
    expect(isDeadlineOverdue({ dueDate: '2026-07-25', status: 'PENDING' })).toBe(true);
    expect(isDeadlineOverdue({ dueDate: '2026-07-25', status: 'COMPLETED' })).toBe(false);
    expect(isDeadlineOverdue({ dueDate: '2026-07-25', status: 'CANCELLED' })).toBe(false);
  });

  it('exposes only explicit status transitions', () => {
    expect(allowedWorkTransitions('TO_DO')).toEqual(['IN_PROGRESS', 'WAITING', 'COMPLETED', 'CANCELLED']);
    expect(allowedWorkTransitions('COMPLETED')).toEqual([]);
    expect(allowedDeadlineTransitions('PENDING')).toEqual(['COMPLETED', 'CANCELLED']);
    expect(allowedDeadlineTransitions('CANCELLED')).toEqual([]);
  });
});
