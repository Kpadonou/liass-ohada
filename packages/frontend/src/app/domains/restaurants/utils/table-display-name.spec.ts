import { tableDisplayName } from './table-display-name';

it('uses the trimmed operational name without a code prefix', () => {
  expect(tableDisplayName({ name: ' TEST CHRIS ', code: 'TC' })).toBe('TEST CHRIS');
  expect(tableDisplayName({ tableName: 'Terrasse', tableCode: 'T03' })).toBe('Terrasse');
});
it('falls back to the code only when the name is absent or blank', () => {
  expect(tableDisplayName({ code: 'T01' })).toBe('T01');
  expect(tableDisplayName({ tableName: '  ', tableCode: 'T02' })).toBe('T02');
});
