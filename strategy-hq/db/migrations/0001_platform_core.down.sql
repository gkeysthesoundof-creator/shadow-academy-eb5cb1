drop table if exists user_cash_entries, user_tasks, user_progress, alert_preferences, player_device_preferences,
  user_game_profiles, game_versions, games, rate_limits, feature_flags, privacy_consents, invites,
  membership_roles, workspaces, sessions, users cascade;
drop function if exists app_user_chapter(text);
drop function if exists app_is_moderator();
drop function if exists app_is_admin();
drop function if exists touch_updated_at();
drop function if exists app_uid();
