/** Calendar date filters use the operational timezone; wire instants remain UTC. */
export function documentDateBoundary(value: string, timeZone: string, end = false): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return '';
  const [year, month, day] = value.split('-').map(Number);
  const midnight = Date.UTC(year, month - 1, day);
  if (new Date(midnight).toISOString().slice(0, 10) !== value) return '';
  const target = midnight + (end ? 86400000 : 0);
  let instant = target;
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  for (let attempt = 0; attempt < 3; attempt++) {
    const parts = Object.fromEntries(
      formatter.formatToParts(new Date(instant)).map((p) => [p.type, p.value]),
    );
    const wall = Date.UTC(
      +parts['year'],
      +parts['month'] - 1,
      +parts['day'],
      +parts['hour'],
      +parts['minute'],
      +parts['second'],
    );
    instant += target - wall;
  }
  return new Date(instant - (end ? 1 : 0)).toISOString();
}
