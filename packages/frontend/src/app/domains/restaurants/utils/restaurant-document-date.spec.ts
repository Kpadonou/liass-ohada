import { documentDateBoundary } from './restaurant-document-date';

it('maps operational calendar dates to exact UTC boundaries', () => {
  expect(documentDateBoundary('2026-11-02', 'Africa/Porto-Novo')).toBe('2026-11-01T23:00:00.000Z');
  expect(documentDateBoundary('2026-11-02', 'Africa/Porto-Novo', true)).toBe(
    '2026-11-02T22:59:59.999Z',
  );
});
it('keeps 31 calendar days bounded and rejects invalid calendar dates', () => {
  const from = documentDateBoundary('2026-11-01', 'Africa/Porto-Novo');
  const to = documentDateBoundary('2026-12-01', 'Africa/Porto-Novo', true);
  expect(Date.parse(to) - Date.parse(from)).toBe(31 * 86400000 - 1);
  expect(documentDateBoundary('2026-02-30', 'UTC')).toBe('');
  expect(documentDateBoundary('', 'UTC')).toBe('');
});
