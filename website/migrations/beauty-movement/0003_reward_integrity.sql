-- Keep the preconfigured-benefit invariant inside D1 as well as in the
-- private importer. A modern invite may only reference a reward from the same
-- campaign and editorial family. Legacy rows with a NULL reward_id remain
-- readable during the additive migration period.

PRAGMA foreign_keys = ON;

CREATE TRIGGER IF NOT EXISTS bm_invites_reward_matches_palette_insert
BEFORE INSERT ON bm_invites
WHEN NEW.reward_id IS NOT NULL
 AND NOT EXISTS (
    SELECT 1
    FROM bm_rewards AS reward
    WHERE reward.campaign_id = NEW.campaign_id
      AND reward.reward_id = NEW.reward_id
      AND reward.family = NEW.palette
 )
BEGIN
    SELECT RAISE(ABORT, 'beauty_movement_reward_mismatch');
END;

CREATE TRIGGER IF NOT EXISTS bm_invites_reward_matches_palette_update
BEFORE UPDATE OF campaign_id, palette, reward_id ON bm_invites
WHEN NEW.reward_id IS NOT NULL
 AND NOT EXISTS (
    SELECT 1
    FROM bm_rewards AS reward
    WHERE reward.campaign_id = NEW.campaign_id
      AND reward.reward_id = NEW.reward_id
      AND reward.family = NEW.palette
 )
BEGIN
    SELECT RAISE(ABORT, 'beauty_movement_reward_mismatch');
END;

CREATE TRIGGER IF NOT EXISTS bm_rewards_preserve_referenced_family
BEFORE UPDATE OF campaign_id, reward_id, family ON bm_rewards
WHEN EXISTS (
    SELECT 1
    FROM bm_invites AS invite
    WHERE invite.campaign_id = OLD.campaign_id
      AND invite.reward_id = OLD.reward_id
      AND (
          NEW.campaign_id <> OLD.campaign_id
          OR NEW.reward_id <> OLD.reward_id
          OR invite.palette <> NEW.family
      )
 )
BEGIN
    SELECT RAISE(ABORT, 'beauty_movement_reward_reference_locked');
END;

CREATE TRIGGER IF NOT EXISTS bm_rewards_prevent_referenced_delete
BEFORE DELETE ON bm_rewards
WHEN EXISTS (
    SELECT 1
    FROM bm_invites AS invite
    WHERE invite.campaign_id = OLD.campaign_id
      AND invite.reward_id = OLD.reward_id
 )
BEGIN
    SELECT RAISE(ABORT, 'beauty_movement_reward_reference_locked');
END;
