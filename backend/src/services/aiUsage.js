import { query } from '../db.js';
import { HttpError } from '../middleware/error.js';
import { config } from '../config.js';

const FREE_DAILY_LIMIT = config.aiChat?.freeDailyLimit ?? 30;
const LIMIT_MESSAGE = "Siz bugungi so'rovlaringizni tugatdingiz. Premium sotib olsangiz, cheksiz so'rov qilishingiz mumkin!";

export async function getAIUsage(userId, isPremium = false) {
  if (isPremium) {
    return { isPremium: true, used: 0, limit: null, remaining: null };
  }
  const r = await query(
    `SELECT count FROM ai_chat_usage WHERE user_id = $1 AND day = CURRENT_DATE`,
    [userId]
  );
  const used = Number(r.rows[0]?.count || 0);
  return {
    isPremium: false,
    used,
    limit: FREE_DAILY_LIMIT,
    remaining: Math.max(0, FREE_DAILY_LIMIT - used),
  };
}

export async function consumeAIUsage(userId, isPremium = false) {
  if (isPremium) return getAIUsage(userId, true);

  const r = await query(
    `INSERT INTO ai_chat_usage (user_id, day, count)
     VALUES ($1, CURRENT_DATE, 1)
     ON CONFLICT (user_id, day)
     DO UPDATE SET count = ai_chat_usage.count + 1,
                   updated_at = now()
       WHERE ai_chat_usage.count < $2
     RETURNING count`,
    [userId, FREE_DAILY_LIMIT]
  );
  if (!r.rows[0]) throw new HttpError(429, LIMIT_MESSAGE);
  const used = Number(r.rows[0].count || 0);
  return {
    isPremium: false,
    used,
    limit: FREE_DAILY_LIMIT,
    remaining: Math.max(0, FREE_DAILY_LIMIT - used),
  };
}
