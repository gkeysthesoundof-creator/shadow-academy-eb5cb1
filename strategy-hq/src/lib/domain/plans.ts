/**
 * Subscription scaffolding. FREE / PLUS / PRO are configurable product labels,
 * not claims that anyone has bought anything. Prices are deliberately null until
 * the owner sets them. FOUNDER is a private grandfathered plan.
 */
export type PlanId = 'free' | 'plus' | 'pro' | 'founder';
export type Feature =
  | 'assistant_queries_daily' | 'manual_refresh_daily' | 'screenshot_uploads_daily'
  | 'private_pins_total' | 'morning_email' | 'map_import' | 'data_export' | 'admin_console';

/** number = daily/total cap, null or true = included without cap, false = not included */
export type Limit = number | null | boolean;

export const PLAN_CATALOG: Record<PlanId, { label: string; description: string; public: boolean; features: Record<Feature, Limit> }> = {
  free: {
    label: 'FREE', description: 'Chapter-aware intel, personal tracking and the in-app brief.', public: true,
    features: { assistant_queries_daily: 5, manual_refresh_daily: 0, screenshot_uploads_daily: 2, private_pins_total: 25,
      morning_email: false, map_import: true, data_export: true, admin_console: false },
  },
  plus: {
    label: 'PLUS', description: 'Morning email brief, more assistant help and more pins.', public: true,
    features: { assistant_queries_daily: 30, manual_refresh_daily: 1, screenshot_uploads_daily: 10, private_pins_total: 250,
      morning_email: true, map_import: true, data_export: true, admin_console: false },
  },
  pro: {
    label: 'PRO', description: 'Highest limits for dedicated hunters.', public: true,
    features: { assistant_queries_daily: 100, manual_refresh_daily: 3, screenshot_uploads_daily: 30, private_pins_total: 2000,
      morning_email: true, map_import: true, data_export: true, admin_console: false },
  },
  founder: {
    label: 'FOUNDER', description: 'Grandfathered full experience for the owner.', public: false,
    features: { assistant_queries_daily: 200, manual_refresh_daily: 10, screenshot_uploads_daily: 50, private_pins_total: null,
      morning_email: true, map_import: true, data_export: true, admin_console: true },
  },
};

export function limitFor(plan: PlanId, feature: Feature): Limit {
  return PLAN_CATALOG[plan].features[feature];
}

/** Resolve the effective plan: grandfathered/active/trialing subscription wins, otherwise FREE. */
export function effectivePlan(subs: { plan_id: PlanId; status: string }[]): PlanId {
  const live = subs.find((s) => ['grandfathered', 'active', 'trialing', 'past_due'].includes(s.status));
  return live?.plan_id ?? 'free';
}
