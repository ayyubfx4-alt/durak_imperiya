// services/voiceChat.js
// Feature 30: Ovozli Chat (Voice Chat) — 1v1 only, 20+ games, mutual consent
// Premium: unlimited sessions; free: 3/day
// Both sides must consent; either side can mute → both disconnected

import { query } from '../db.js';
import { config } from '../config.js';
import { getThresholds, isUnlocked } from './progression.js';
import { isVoiceChatEnabled } from './adminSettings.js';

const FREE_DAILY_LIMIT = config.voiceChat?.freeDailyLimit ?? 3;

/**
 * Returns how many voice sessions the user has used today.
 */
export async function getDailyVoiceCount(userId) {
  const r = await query(
    `SELECT count FROM user_daily_voice WHERE user_id = $1 AND day = CURRENT_DATE`,
    [userId]
  );
  return Number(r.rows[0]?.count || 0);
}

/**
 * Increments the daily counter for a user.
 */
async function incrementDailyVoice(userId) {
  await query(
    `INSERT INTO user_daily_voice (user_id, day, count)
     VALUES ($1, CURRENT_DATE, 1)
     ON CONFLICT (user_id, day)
     DO UPDATE SET count = user_daily_voice.count + 1`,
    [userId]
  );
}

/**
 * Check if the user is eligible to start/accept a voice session.
 * Returns { allowed: bool, reason?: string }
 */
export async function canUseVoice(userId, isPremium) {
  if (!await isVoiceChatEnabled()) {
    return { allowed: false, reason: 'Ovozli chat admin tomonidan o\'chirilgan.' };
  }
  const u = await query(
    'SELECT games_played, is_muted, muted_until, muted_reason FROM users WHERE id = $1',
    [userId]
  );
  const mutedUntil = u.rows[0]?.muted_until ? new Date(u.rows[0].muted_until) : null;
  const isMuted = !!u.rows[0]?.is_muted && (!mutedUntil || mutedUntil > new Date());
  if (isMuted) {
    return { allowed: false, reason: u.rows[0]?.muted_reason || 'Siz admin tomonidan mute qilingansiz.' };
  }
  const gamesPlayed = Number(u.rows[0]?.games_played || 0);
  if (!await isUnlocked(gamesPlayed, 'voice_chat')) {
    const thresholds = await getThresholds();
    const required = Number(thresholds.voice_chat || 0);
    return { allowed: false, reason: `Ovozli chat ${required} ta o'yindan keyin ochiladi.` };
  }
  if (isPremium) return { allowed: true };
  const count = await getDailyVoiceCount(userId);
  if (count >= FREE_DAILY_LIMIT) {
    return { allowed: false, reason: `Kunlik limit: ${FREE_DAILY_LIMIT} ta o'yin. Premium rejimga o'ting.` };
  }
  return { allowed: true };
}

/**
 * Log a new voice session when BOTH players consent.
 * Increments the daily counter for both users.
 * Returns the session row.
 */
export async function startVoiceSession(roomCode, userAId, userBId) {
  const r = await query(
    `INSERT INTO voice_chat_sessions (room_code, user_a, user_b)
     VALUES ($1, $2, $3)
     RETURNING id, room_code, user_a, user_b, started_at`,
    [roomCode, userAId, userBId]
  );
  // Increment daily counters for both users
  await Promise.all([
    incrementDailyVoice(userAId),
    incrementDailyVoice(userBId),
  ]);
  return r.rows[0];
}

/**
 * End the active voice session for a room (called when either player mutes).
 * Returns the updated session or null if no active session.
 */
export async function endVoiceSession(roomCode) {
  const r = await query(
    `UPDATE voice_chat_sessions
        SET ended_at = now()
      WHERE room_code = $1 AND ended_at IS NULL
      RETURNING id`,
    [roomCode]
  );
  return r.rows[0] || null;
}

/**
 * Get the currently active voice session for a room.
 */
export async function getActiveVoiceSession(roomCode) {
  const r = await query(
    `SELECT id, room_code, user_a, user_b, started_at
       FROM voice_chat_sessions
      WHERE room_code = $1 AND ended_at IS NULL
      ORDER BY started_at DESC
      LIMIT 1`,
    [roomCode]
  );
  return r.rows[0] || null;
}
