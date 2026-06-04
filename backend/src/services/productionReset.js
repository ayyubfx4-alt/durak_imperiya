import { query, withTransaction } from '../db.js';
import { HttpError } from '../middleware/error.js';

export const PRODUCTION_RESET_CONFIRMATION = 'REAL_PRODUCTION_RESET';

const RESET_TABLES = [
  'achievement_inbox',
  'achievements',
  'admin_broadcasts',
  'admin_events',
  'admin_inbox',
  'ai_chat_usage',
  'antibot_scores',
  'baraban_jackpot_grants',
  'baraban_spins',
  'donations',
  'elon_sticker_grants',
  'feature_unlocks',
  'friends',
  'games',
  'gifts',
  'gold_perks_log',
  'gold_transactions',
  'inventory',
  'item_price_overrides',
  'messages',
  'mm_history',
  'monthly_badges',
  'promotions',
  'referrals',
  'reports',
  'stickers',
  'stripe_payments',
  'support_ticket_messages',
  'support_tickets',
  'telegram_broadcasts',
  'telegram_users',
  'tournament_entries',
  'tournament_gifts',
  'tournament_matches',
  'tournament_payouts',
  'tournaments',
  'transactions',
  'user_daily_voice',
  'voice_chat_sessions',
  'admin_items',
];

const PREVIEW_TABLES = [
  ['realUsers', "users WHERE is_admin IS NOT TRUE AND is_bot IS NOT TRUE"],
  ['adminUsers', 'users WHERE is_admin IS TRUE'],
  ['games', 'games'],
  ['stickers', 'stickers'],
  ['catalogItems', 'admin_items'],
  ['transactions', 'transactions'],
  ['goldTransactions', 'gold_transactions'],
  ['donations', 'donations'],
  ['supportTickets', 'support_tickets'],
  ['reports', 'reports'],
  ['telegramUsers', 'telegram_users'],
];

function quoteIdent(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}

async function existingTables(client, names) {
  const r = await client.query(
    `SELECT tablename
       FROM pg_tables
      WHERE schemaname = 'public'
        AND tablename = ANY($1::text[])`,
    [names]
  );
  return names.filter((name) => r.rows.some((row) => row.tablename === name));
}

export async function productionResetPreview() {
  const out = {};
  for (const [key, source] of PREVIEW_TABLES) {
    const r = await query(`SELECT COUNT(*)::int AS count FROM ${source}`).catch(() => ({ rows: [{ count: 0 }] }));
    out[key] = Number(r.rows[0]?.count || 0);
  }
  return {
    confirmation: PRODUCTION_RESET_CONFIRMATION,
    counts: out,
  };
}

export async function runProductionReset({ confirmation, adminId }) {
  if (confirmation !== PRODUCTION_RESET_CONFIRMATION) {
    throw new HttpError(400, `confirmation must be ${PRODUCTION_RESET_CONFIRMATION}`);
  }

  const before = await productionResetPreview();
  await withTransaction(async (client) => {
    const tables = await existingTables(client, RESET_TABLES);
    if (tables.length) {
      await client.query(`TRUNCATE ${tables.map(quoteIdent).join(', ')} RESTART IDENTITY CASCADE`);
    }
    await client.query(`DELETE FROM users WHERE is_admin IS NOT TRUE`);
    await client.query(`
      UPDATE users
         SET coins = 0,
             gold_coins = 0,
             games_played = 0,
             games_won = 0,
             games_lost = 0,
             games_draw = 0,
             win_streak = 0,
             loss_streak = 0,
             premium_until = NULL,
             updated_at = now()
       WHERE is_admin IS TRUE
    `).catch(() => {});
    await client.query(`UPDATE bot_pool SET busy = FALSE`).catch(() => {});
    await client.query(`
      INSERT INTO system_stats (id, total_users, total_revenue_uzs, online_users, server_status, updated_at)
      VALUES (1, 0, 0, 0, 'stable', now())
      ON CONFLICT (id) DO UPDATE
        SET total_users = 0,
            total_revenue_uzs = 0,
            online_users = 0,
            server_status = 'stable',
            updated_at = now()
    `).catch(() => {});
    await client.query(
      `INSERT INTO audit_log (admin_id, action, target_id, metadata)
       VALUES ($1, 'production_reset', NULL, $2)`,
      [adminId || null, JSON.stringify({ before: before.counts })]
    ).catch(() => {});
  });

  return {
    ok: true,
    before: before.counts,
    after: (await productionResetPreview()).counts,
  };
}
