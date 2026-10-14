export function serviceDuration(
  openedAt: string,
  now: number,
): { key: string; values?: { minutes: number; hours?: number } } {
  const minutes = Math.max(0, Math.floor((now - Date.parse(openedAt)) / 60_000));
  return minutes < 1
    ? { key: 'RESTAURANTS.SERVICE.UNDER_MINUTE' }
    : minutes < 60
      ? { key: 'RESTAURANTS.SERVICE.MINUTES', values: { minutes } }
      : {
          key: 'RESTAURANTS.SERVICE.HOURS',
          values: { hours: Math.floor(minutes / 60), minutes: minutes % 60 },
        };
}
