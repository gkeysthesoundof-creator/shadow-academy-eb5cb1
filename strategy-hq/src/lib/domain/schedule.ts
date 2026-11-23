/**
 * DST-safe scheduling in America/New_York (or any IANA zone). The external cron
 * fires every 15 minutes in UTC; these helpers decide, in local wall-clock time,
 * whether the scan or brief stage is due. No fixed UTC offsets anywhere.
 */
export interface LocalParts { date: string; hour: number; minute: number; }

export function localParts(at: Date, timeZone: string): LocalParts {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });
  const p = Object.fromEntries(fmt.formatToParts(at).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour), minute: Number(p.minute) };
}

export function parseHHMM(s: string): { h: number; m: number } {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) throw new Error(`bad time ${s}`);
  const h = Number(m[1]); const mm = Number(m[2]);
  if (h > 23 || mm > 59) throw new Error(`bad time ${s}`);
  return { h, m: mm };
}

/** True once local wall-clock time has reached `hhmm` on the local date. */
export function reachedLocalTime(at: Date, timeZone: string, hhmm: string): boolean {
  const lp = localParts(at, timeZone);
  const t = parseHHMM(hhmm);
  return lp.hour * 60 + lp.minute >= t.h * 60 + t.m;
}

export type Stage = 'idle' | 'scan' | 'brief';

/**
 * Decide what the tick should do. Scan once per local day after scanTime; brief
 * once per local day after briefTime AND only after that day's scan finished
 * (or a 90-minute grace window lapsed, in which case the brief reports the failure honestly).
 */
export function decideStage(opts: {
  now: Date; timeZone: string; scanTime: string; briefTime: string;
  scanDoneToday: boolean; briefDoneToday: boolean;
}): Stage {
  const { now, timeZone, scanTime, briefTime, scanDoneToday, briefDoneToday } = opts;
  if (!scanDoneToday && reachedLocalTime(now, timeZone, scanTime)) return 'scan';
  if (!briefDoneToday && reachedLocalTime(now, timeZone, briefTime)) {
    if (scanDoneToday) return 'brief';
    const b = parseHHMM(briefTime); const lp = localParts(now, timeZone);
    if (lp.hour * 60 + lp.minute >= b.h * 60 + b.m + 90) return 'brief';
  }
  return 'idle';
}

export function formatLocalDate(dateIso: string) {
  const [y, m, d] = dateIso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}
