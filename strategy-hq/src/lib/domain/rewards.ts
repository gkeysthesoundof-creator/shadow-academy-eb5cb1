/**
 * Rewards Radar rules. GTA VI and GTA Online never mix; GTA+ is a subscription,
 * never "free"; purchase-bundled perks are "included with purchase", never "free".
 */
export type GameScope = 'GTA_VI' | 'GTA_ONLINE';
export type CostType = 'free' | 'included_with_purchase' | 'subscription' | 'paid' | 'unknown';
export type RewardStatus = 'active' | 'upcoming' | 'expired' | 'unknown';

export interface RewardRow {
  game_scope: GameScope;
  cost_type: CostType;
  status: RewardStatus;
  platforms: string[];
  ends_at: string | Date | null;
  starts_at?: string | Date | null;
}

export type RadarFilter = 'free_today' | 'with_purchase' | 'gta_plus' | 'paid' | 'expired' | 'unknown';

/** Effective status re-derived from dates so a stale "active" label can never outlive its deadline. */
export function effectiveStatus(r: RewardRow, now = new Date()): RewardStatus {
  if (r.ends_at && new Date(r.ends_at) < now) return 'expired';
  if (r.starts_at && new Date(r.starts_at) > now) return 'upcoming';
  return r.status;
}

export function radarBucket(r: RewardRow, now = new Date()): RadarFilter {
  const s = effectiveStatus(r, now);
  if (s === 'expired') return 'expired';
  if (r.cost_type === 'free' && s === 'active') return 'free_today';
  if (r.cost_type === 'included_with_purchase') return 'with_purchase';
  if (r.cost_type === 'subscription') return 'gta_plus';
  if (r.cost_type === 'paid') return 'paid';
  return 'unknown';
}

/** The GTA VI single-player rewards view. GTA Online items are excluded outright. */
export function gta6Rewards<T extends RewardRow>(rows: T[]): T[] {
  return rows.filter((r) => r.game_scope === 'GTA_VI');
}

export function relevantToPlatform(r: RewardRow, platform: string): boolean {
  return r.platforms.length === 0 || r.platforms.includes(platform) || r.platforms.includes('ALL');
}

export function deadlineSoon(r: RewardRow, now = new Date(), hours = 72): boolean {
  if (!r.ends_at || effectiveStatus(r, now) !== 'active') return false;
  const ms = new Date(r.ends_at).getTime() - now.getTime();
  return ms > 0 && ms <= hours * 3600_000;
}

/** Deterministic classifier for official text: decides scope + cost type with conservative fallbacks. */
export function classifyRewardText(text: string): { game_scope: GameScope; cost_type: CostType } {
  const t = text.toLowerCase();
  const online = /\bgta online\b|\bgrand theft auto online\b/.test(t);
  const six = /\bgta vi\b|\bgta 6\b|\bgrand theft auto vi\b/.test(t);
  const game_scope: GameScope = online && !six ? 'GTA_ONLINE' : online && six ? 'GTA_ONLINE' : 'GTA_VI';
  let cost_type: CostType = 'unknown';
  if (/gta\+|subscription|subscriber|members?hip/.test(t)) cost_type = 'subscription';
  else if (/with (any|a) (qualifying )?purchase|pre-?order|when you (buy|purchase)|included with/.test(t)) cost_type = 'included_with_purchase';
  else if (/\$\d|gta\$ ?\d|buy now|for purchase|price/.test(t) && !/free/.test(t)) cost_type = 'paid';
  else if (/\bfree\b|no cost|at no charge/.test(t)) cost_type = 'free';
  return { game_scope, cost_type };
}
