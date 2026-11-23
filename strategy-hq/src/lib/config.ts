/**
 * Server configuration. Every external integration is OFF unless its variables
 * are present AND its feature flag is enabled by the owner. Values are never
 * logged; `integrationStatus()` reports names + configured/missing only.
 */
export type AppMode = 'founder_private' | 'closed_beta' | 'commercial';

function env(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() !== '' ? v.trim() : undefined;
}

export const config = {
  get appMode(): AppMode {
    const m = env('APP_MODE');
    return m === 'closed_beta' || m === 'commercial' ? m : 'founder_private';
  },
  get databaseUrl() {
    const v = env('DATABASE_URL');
    if (v) return v;
    if (process.env.NODE_ENV === 'production' && !process.env.NEXT_PHASE) throw new Error('DATABASE_URL is required in production');
    return 'postgres://gsq_owner:dev-only-owner@127.0.0.1:5432/gsq';   // local development default only
  },
  get appBaseUrl() { return env('APP_BASE_URL') ?? 'http://localhost:3100'; },
  get cronSecret() { return env('CRON_SECRET'); },
  get timezone() { return env('BRIEF_TIMEZONE') ?? 'America/New_York'; },
  get scanLocalTime() { return env('SCAN_LOCAL_TIME') ?? '07:15'; },
  get briefLocalTime() { return env('BRIEF_LOCAL_TIME') ?? '08:30'; },
  // Email (Resend). REPORT_ENABLED must be literally "true" AND the owner flag on.
  get resendApiKey() { return env('RESEND_API_KEY'); },
  get reportFromEmail() { return env('REPORT_FROM_EMAIL'); },
  get reportToEmail() { return env('REPORT_TO_EMAIL'); },
  get reportEnabled() { return env('REPORT_ENABLED') === 'true'; },
  // Assistant (Anthropic). Optional; local retrieval fallback otherwise.
  get anthropicApiKey() { return env('ANTHROPIC_API_KEY'); },
  get assistantModel() { return env('ASSISTANT_MODEL') ?? 'claude-opus-5-5'; },
  get llmDailyBudgetMicros() { return Number(env('LLM_DAILY_BUDGET_USD') ?? '1') * 1_000_000; },
  // Reddit Data API (requires approved app + commercial agreement for paid product).
  get redditClientId() { return env('REDDIT_CLIENT_ID'); },
  get redditClientSecret() { return env('REDDIT_CLIENT_SECRET'); },
  get redditUserAgent() { return env('REDDIT_USER_AGENT'); },
  // Billing provider (staging only).
  get billingProvider() { return env('BILLING_PROVIDER') ?? 'none'; },
  get billingWebhookSecret() { return env('BILLING_WEBHOOK_SECRET'); },
  get uploadDir() { return env('UPLOAD_DIR') ?? '.data/uploads'; },
  get isProduction() { return process.env.NODE_ENV === 'production'; },
};

export type IntegrationState = 'configured' | 'missing_credentials' | 'disabled_by_owner' | 'local_only';

export function integrationStatus() {
  return {
    database: { state: 'configured' as IntegrationState, vars: ['DATABASE_URL'] },
    scheduler: { state: (config.cronSecret ? 'configured' : 'missing_credentials') as IntegrationState, vars: ['CRON_SECRET'] },
    email: {
      state: (!config.resendApiKey || !config.reportFromEmail || !config.reportToEmail
        ? 'missing_credentials' : config.reportEnabled ? 'configured' : 'disabled_by_owner') as IntegrationState,
      vars: ['RESEND_API_KEY', 'REPORT_FROM_EMAIL', 'REPORT_TO_EMAIL', 'REPORT_ENABLED'],
    },
    assistant: { state: (config.anthropicApiKey ? 'configured' : 'missing_credentials') as IntegrationState, vars: ['ANTHROPIC_API_KEY'] },
    reddit: {
      state: (config.redditClientId && config.redditClientSecret && config.redditUserAgent ? 'configured' : 'missing_credentials') as IntegrationState,
      vars: ['REDDIT_CLIENT_ID', 'REDDIT_CLIENT_SECRET', 'REDDIT_USER_AGENT'],
    },
    billing: {
      state: (config.billingProvider !== 'none' && config.billingWebhookSecret ? 'configured' : 'missing_credentials') as IntegrationState,
      vars: ['BILLING_PROVIDER', 'BILLING_WEBHOOK_SECRET'],
    },
  };
}
