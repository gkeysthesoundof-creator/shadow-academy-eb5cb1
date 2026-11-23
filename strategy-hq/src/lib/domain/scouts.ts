/**
 * The ten specialist scouts. They are typed lenses + deterministic workers over
 * ONE shared findings store — not ten always-on AI sessions.
 */
export type FindingCategory =
  | 'vehicle' | 'weapon' | 'cash_pickup' | 'money_activity' | 'secret' | 'collectible'
  | 'mission_tip' | 'map_location' | 'reward' | 'update' | 'community';

export type ScoutId =
  | 'vehicle_scout' | 'weapons_scout' | 'money_scout' | 'secrets_scout' | 'strategy_scout'
  | 'map_scout' | 'rewards_scout' | 'community_scout' | 'evidence_scout' | 'briefing_scout';

export interface ScoutDef {
  id: ScoutId;
  slug: string;              // URL segment
  name: string;
  shortName: string;
  icon: string;
  color: 'coral' | 'cyan' | 'gold' | 'purple' | 'pink' | 'green' | 'sand';
  sort: number;
  description: string;
  /** Finding categories this scout owns (empty = cross-cutting/operational scout). */
  categories: FindingCategory[];
  /** Keywords the deterministic router uses to route raw source items to this lens. */
  keywords: string[];
  /** What a record from this scout must carry (shown on detail pages as known/UNKNOWN). */
  recordFields: { key: string; label: string }[];
  /** Is this a "hunt" lens with its own workbench list? */
  workbench: boolean;
  priority: 1 | 2 | 3;
}

export const SCOUTS: ScoutDef[] = [
  {
    id: 'vehicle_scout', slug: 'vehicles', name: 'Vehicle Hunter', shortName: 'Vehicles', icon: '🚗', color: 'coral', sort: 1, priority: 1,
    description: 'Rare, unique and free vehicles, special parked finds, hidden garages, respawn rules and limited-time rides. Spawns are never promised.',
    categories: ['vehicle'],
    keywords: ['car', 'vehicle', 'bike', 'motorcycle', 'boat', 'plane', 'helicopter', 'garage', 'spawn', 'supercar', 'truck', 'ride'],
    recordFields: [
      { key: 'make_model', label: 'Make / model' }, { key: 'vehicle_class', label: 'Class' },
      { key: 'spawn_conditions', label: 'Spawn conditions' }, { key: 'reproducibility', label: 'Reproducibility' },
      { key: 'acquisition_cost', label: 'Acquisition cost' }, { key: 'resale_value', label: 'Resale value (verified only)' },
      { key: 'respawns', label: 'Respawns?' },
    ],
    workbench: true,
  },
  {
    id: 'weapons_scout', slug: 'weapons', name: 'Weapons Scout', shortName: 'Weapons', icon: '🔫', color: 'cyan', sort: 2, priority: 1,
    description: 'Unique firearms, free pickups, ammo, armor and weapon caches with unlock conditions. Stat comparisons only from reliable data.',
    categories: ['weapon'],
    keywords: ['weapon', 'gun', 'rifle', 'pistol', 'shotgun', 'smg', 'sniper', 'ammo', 'armor', 'armour', 'cache', 'melee', 'launcher'],
    recordFields: [
      { key: 'weapon_type', label: 'Weapon type' }, { key: 'unlock_condition', label: 'Unlock condition' },
      { key: 'price', label: 'Price' }, { key: 'respawns', label: 'Respawns?' }, { key: 'stats_source', label: 'Stats source' },
    ],
    workbench: true,
  },
  {
    id: 'money_scout', slug: 'cash', name: 'Cash Trail Scout', shortName: 'Cash', icon: '💰', color: 'gold', sort: 3, priority: 1,
    description: 'Money lying in the world (pickups, safes, stashes) kept separate from income activities (jobs, robberies). No invented cash-per-hour.',
    categories: ['cash_pickup', 'money_activity'],
    keywords: ['money', 'cash', 'stash', 'safe', 'loot', 'robbery', 'heist', 'payout', 'job', 'earn', 'income', 'bag', 'register'],
    recordFields: [
      { key: 'money_kind', label: 'World money or income activity' }, { key: 'payout', label: 'Payout range' },
      { key: 'time_to_complete', label: 'Time to complete' }, { key: 'cooldown', label: 'Cooldown' },
      { key: 'wanted_risk', label: 'Wanted-level risk' }, { key: 'transfers', label: 'Carries across chapters?' },
    ],
    workbench: true,
  },
  {
    id: 'secrets_scout', slug: 'secrets', name: 'Secrets & Collectibles', shortName: 'Secrets', icon: '💎', color: 'purple', sort: 4, priority: 2,
    description: 'Collectibles, hidden locations, Easter eggs and unlockables with spoiler-tagged requirements.',
    categories: ['secret', 'collectible'],
    keywords: ['secret', 'easter egg', 'collectible', 'hidden', 'mystery', 'unlockable', 'rare find'],
    recordFields: [{ key: 'collectible_set', label: 'Collection set' }, { key: 'requirements', label: 'Requirements' }],
    workbench: true,
  },
  {
    id: 'strategy_scout', slug: 'missions', name: 'Mission & Tactics Coach', shortName: 'Missions', icon: '🎮', color: 'pink', sort: 5, priority: 2,
    description: 'Chapter-aware routes, stealth, combat and driving help. PS5 controls only when sourced. Answers on demand.',
    categories: ['mission_tip'],
    keywords: ['mission', 'stuck', 'objective', 'stealth', 'combat', 'driving', 'chase', 'controls', 'tip', 'strategy', 'walkthrough'],
    recordFields: [{ key: 'mission_stage', label: 'Mission stage' }, { key: 'controls_source', label: 'Controls source' }],
    workbench: true,
  },
  {
    id: 'map_scout', slug: 'map', name: 'Cartographer & Visual', shortName: 'Map', icon: '🗺️', color: 'green', sort: 6, priority: 2,
    description: 'Turns verified landmarks into location cards and pins. No coordinates inferred from prose; no image without cleared rights.',
    categories: ['map_location'],
    keywords: ['location', 'map', 'landmark', 'coordinates', 'where is', 'found at', 'near'],
    recordFields: [{ key: 'landmark', label: 'Landmark' }, { key: 'pin_precision', label: 'Pin precision' }],
    workbench: false,
  },
  {
    id: 'rewards_scout', slug: 'rewards', name: 'Rockstar Free Rewards', shortName: 'Rewards', icon: '🎁', color: 'gold', sort: 7, priority: 2,
    description: 'Official GTA VI bonuses and free gifts with deadlines. GTA VI and GTA Online strictly separated; free vs paid vs GTA+ labeled.',
    categories: ['reward', 'update'],
    keywords: ['free', 'reward', 'bonus', 'gift', 'gta+', 'claim', 'limited time', 'newswire', 'update', 'patch', 'title update'],
    recordFields: [{ key: 'cost_type', label: 'Cost type' }, { key: 'deadline', label: 'Deadline' }, { key: 'platforms', label: 'Platforms' }],
    workbench: true,
  },
  {
    id: 'community_scout', slug: 'community', name: 'Community Discovery', shortName: 'Community', icon: '📡', color: 'cyan', sort: 8, priority: 3,
    description: 'Watches permitted communities through approved access only. Keeps dated link-outs and coverage gaps. Never claims full coverage.',
    categories: ['community'],
    keywords: [],
    recordFields: [],
    workbench: false,
  },
  {
    id: 'evidence_scout', slug: 'evidence', name: 'Verification & Corrections', shortName: 'Evidence', icon: '🧾', color: 'sand', sort: 9, priority: 3,
    description: 'Reconciles sources, assigns evidence tiers, catches patches, expiries, debunks and rights risks. Keeps a public change log.',
    categories: [],
    keywords: ['patched', 'fixed', 'removed', 'debunked', 'fake', 'no longer works'],
    recordFields: [],
    workbench: false,
  },
  {
    id: 'briefing_scout', slug: 'briefing', name: 'Morning Brief & Ops', shortName: 'Brief', icon: '☀️', color: 'coral', sort: 10, priority: 3,
    description: 'Runs after all scouts. Builds ONE deduplicated personal brief per day and reports stale sources and worker failures.',
    categories: [],
    keywords: [],
    recordFields: [],
    workbench: false,
  },
];

export const PRIORITY_SCOUTS: ScoutId[] = ['vehicle_scout', 'weapons_scout', 'money_scout'];

export function scoutById(id: string) { return SCOUTS.find((s) => s.id === id); }
export function scoutBySlug(slug: string) { return SCOUTS.find((s) => s.slug === slug); }

/** Every scout lens a finding category belongs to (one finding can sit under several scouts). */
export function scoutsForCategory(cat: FindingCategory): ScoutId[] {
  const owners = SCOUTS.filter((s) => s.categories.includes(cat)).map((s) => s.id);
  // Anything with a place is also a Cartographer concern.
  return owners;
}

export const CATEGORY_LABELS: Record<FindingCategory, string> = {
  vehicle: 'Rare vehicle', weapon: 'Weapon / gear', cash_pickup: 'Hidden cash', money_activity: 'Money activity',
  secret: 'Secret', collectible: 'Collectible', mission_tip: 'Mission tip', map_location: 'Location',
  reward: 'Rockstar reward', update: 'Official update', community: 'Community report',
};
