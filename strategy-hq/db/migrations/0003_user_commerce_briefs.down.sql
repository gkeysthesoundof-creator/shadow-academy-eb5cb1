drop function if exists consume_usage(text,integer,date);
drop table if exists platform_budget, usage_meter, billing_webhook_events, entitlements, subscriptions,
  billing_customers, plan_catalog, delivery_attempts, digest_sections, digest_runs, user_screenshots,
  user_private_pins, user_hunts cascade;
