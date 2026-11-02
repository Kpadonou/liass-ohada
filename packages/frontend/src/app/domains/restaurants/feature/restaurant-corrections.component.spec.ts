import { correctionRole, refundContext } from './restaurant-corrections.component';
import { correctionError } from '../utils/restaurant-correction-error';
import { HttpErrorResponse } from '@angular/common/http';
it.each(['OWNER', 'MANAGER'])('allows creation controls for %s', (role) =>
  expect(correctionRole(role)).toBe(true),
);
it.each(['CASHIER', 'WAITER', 'KITCHEN', undefined])('hides creation controls for %s', (role) =>
  expect(correctionRole(role)).toBe(false),
);
const day = { businessDayId: 'day', status: 'OPEN' as const };
const session = { businessDayId: 'day', status: 'OPEN' as const, cashierUserId: 'user' };
it('requires own open financial execution context', () => {
  expect(refundContext('user', session, day)).toBe(true);
  expect(refundContext('user', null, day)).toBe(false);
  expect(refundContext('other', session, day)).toBe(false);
  expect(refundContext('user', { ...session, status: 'CLOSED' }, day)).toBe(false);
  expect(refundContext('user', session, { ...day, status: 'CLOSED' })).toBe(false);
  expect(refundContext('user', { ...session, businessDayId: 'other' }, day)).toBe(false);
});
it.each([
  'RESTAURANTS_CREDIT_CONFLICT',
  'RESTAURANTS_REFUND_EXCEEDED',
  'RESTAURANTS_REFUND_IDEMPOTENCY',
])('maps %s to refresh guidance', (code) => {
  expect(correctionError(new HttpErrorResponse({ status: 409, error: { error: { code } } }))).toBe(
    'RESTAURANTS_CORRECTIONS.AVAILABILITY_CHANGED',
  );
});
it('never exposes implementation errors', () =>
  expect(correctionError(new Error('DynamoDB PK secret'))).toBe('RESTAURANTS_CORRECTIONS.RETRY'));
