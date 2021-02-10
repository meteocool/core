export function roundToHour(date) {
  const p = 60 * 60 * 1000; // milliseconds in an hour
  return new Date(Math.round(date.getTime() / p) * p).getHours();
}
