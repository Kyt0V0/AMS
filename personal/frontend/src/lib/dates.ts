export function deviceTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export interface DateFormatters {
  formatDate: (iso: string | null) => string;

  formatDay: (iso: string | null) => string;
}

export function dateFormatters(lang: string, timeZone?: string): DateFormatters {
  const dateTime = new Intl.DateTimeFormat(lang, { dateStyle: "medium", timeStyle: "short", timeZone });
  const day = new Intl.DateTimeFormat(lang, { dateStyle: "medium", timeZone });
  const format = (formatter: Intl.DateTimeFormat) => (iso: string | null) => {
    const time = iso ? Date.parse(iso) : NaN;
    return Number.isNaN(time) ? "–" : formatter.format(time);
  };
  return { formatDate: format(dateTime), formatDay: format(day) };
}

function localMidnight(time: number): number {
  const date = new Date(time);
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
}

export function ageInDays(iso: string, now: number = Date.now()): number | null {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return null;
  return Math.max(0, Math.round((localMidnight(now) - localMidnight(time)) / 86_400_000));
}
