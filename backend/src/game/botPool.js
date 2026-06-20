/**
 * Bot pool — TOR §3.
 *
 * MIJOZ TALABI (production):
 *   "real odamlar tuldiradi" — botlar faqat real o'yinchilar yetishmasa
 *   ishlatiladi. Real o'yinchi kirsa, bot avtomatik almashtirilmaydi
 *   (bu room.js ichida amalga oshirilgan).
 *
 * Bu fayl bot DB pool bilan ishlashni boshqaradi: bo'sh botlarni olib turish,
 * o'yindan keyin qaytarish. Bot identifikatori boshqa o'yinchilarga
 * ko'rsatilmaydi (TOR §3 — botlar inson kabi ko'rinishi).
 */
import { query } from '../db.js';
import { BOT_NAMES, buildBotPoolSpec, pickBotName } from '../data/botNames.js';
import { logger } from '../logger.js';

const inUse = new Set();
const LEVEL_SCORE = { easy: 0, medium: 1, hard: 2 };

function normalizeLevel(level) {
  return LEVEL_SCORE[level] === undefined ? 'medium' : level;
}

/**
 * Bo'sh botni egallash. Eng past `last_used_at` bo'lganini tanlaymiz
 * (ekrand atrofida aylanish uchun). Agar DB pool topilmasa, deterministik
 * fallback (botNames asosida) ishlatamiz.
 */
export async function acquireBot({ excludeUsernames = new Set(), preferredLevel = 'medium' } = {}) {
  const wantedLevel = normalizeLevel(preferredLevel);
  try {
    const exclude = Array.from(excludeUsernames);
    const r = await query(
      `SELECT id, username, bot_level, rank_wins,
              avatar_color, avatar_lines, avatar_pluses
         FROM bot_pool
        WHERE busy = FALSE AND username <> ALL($1::text[])
        ORDER BY
          CASE
            WHEN bot_level = $2 THEN 0
            WHEN ABS(
              CASE bot_level WHEN 'easy' THEN 0 WHEN 'hard' THEN 2 ELSE 1 END
              - CASE $2 WHEN 'easy' THEN 0 WHEN 'hard' THEN 2 ELSE 1 END
            ) = 1 THEN 1
            ELSE 2
          END ASC,
          last_used_at ASC NULLS FIRST,
          created_at ASC
        LIMIT 1`,
      [exclude.length ? exclude : [''], wantedLevel]
    );
    const row = r.rows[0];
    if (row) {
      await query(
        `UPDATE bot_pool SET busy = TRUE WHERE id = $1`,
        [row.id]
      );
      inUse.add(row.id);
      return {
        id: row.id,
        username: row.username,
        botLevel: row.bot_level,
        rankWins: row.rank_wins,
        avatarColor: row.avatar_color,
        avatarLines: row.avatar_lines,
        avatarPluses: row.avatar_pluses,
      };
    }
  } catch (err) {
    logger.warn('acquireBot DB query failed: %s — falling back to in-memory pool', err.message);
  }

  // Fallback (DB ulanmagan / pool bo'sh)
  const name = pickBotName(excludeUsernames);
  return {
    id: `bot-fallback-${name}-${Date.now()}`,
    username: name,
    botLevel: wantedLevel,
    rankWins: 0,
    avatarColor: 'white',
    avatarLines: 0,
    avatarPluses: 0,
  };
}

/**
 * Botni pool'ga qaytarish. Bot ID bo'lmasa (fallback bot), e'tibor bermaymiz.
 */
export async function releaseBot(botId) {
  if (!botId || typeof botId !== 'string') return;
  inUse.delete(botId);
  if (!botId.startsWith('bot-fallback-')) {
    try {
      await query(
        `UPDATE bot_pool SET busy = FALSE, last_used_at = NOW() WHERE id = $1`,
        [botId]
      );
    } catch (err) {
      logger.warn('releaseBot failed: %s', err.message);
    }
  }
}

/** Server boshlanganida barcha botlarni "bo'sh" deb belgilash. */
export async function resetBotPool() {
  try {
    await query(`UPDATE bot_pool SET busy = FALSE WHERE busy = TRUE`);
  } catch (err) {
    logger.warn('resetBotPool failed: %s', err.message);
  }
}

export async function ensureSeeded() {
  try {
    const existing = await query('SELECT count(*)::int AS c FROM bot_pool');
    if (Number(existing.rows[0]?.c || 0) >= BOT_NAMES.length) return;

    const bots = buildBotPoolSpec();
    for (const bot of bots) {
      await query(
        `INSERT INTO bot_pool (
           id, username, rank_wins, avatar_color, avatar_lines, avatar_pluses, bot_level
         ) VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (id) DO NOTHING`,
        [
          bot.id,
          bot.username,
          bot.rankWins,
          bot.avatarColor,
          bot.avatarLines,
          bot.avatarPluses,
          bot.botLevel,
        ]
      );
    }
  } catch (err) {
    logger.warn('ensureSeeded failed: %s', err.message);
  }
}

export { BOT_NAMES };
