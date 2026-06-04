// services/baraban.js
// Feature 31: Baraban (Spin Wheel)
// Rewards are server-authoritative and granted in one DB transaction.

import { query, withTransaction } from '../db.js';
import { EMOJI_PACKS } from '../data/emojiPacks.js';
import { PROFILE_FRAMES } from '../data/profileFrames.js';
import { config } from '../config.js';
import { getThresholds } from './progression.js';
import { computeRankFromWins } from './rank.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_FREE_SPIN_GAMES_REQUIRED = Number(config.baraban?.gamesRequired || 10);
const VIP_DAYS = 1;
const RANK_POINT_REWARD = 25;

// The user's requested rewards are converted into a clean 100% server table.
// The explicit reward odds are kept; the remaining chance is split evenly
// between "reroll" and "empty" so the wheel cannot exceed 100%.
export const BARABAN_PRIZES = [
  { type: 'coins',        weight: 30, amount: 50,   label: '50 Durak Dollar' },
  { type: 'coins',        weight: 20, amount: 100,  label: '100 Durak Dollar' },
  { type: 'coins',        weight: 15, amount: 250,  label: '250 Durak Dollar' },
  { type: 'coins',        weight: 10, amount: 500,  label: '500 Durak Dollar' },
  { type: 'coins',        weight: 5,  amount: 1000, label: '1000 Durak Dollar' },
  { type: 'premium_day',  weight: 1,  amount: VIP_DAYS, label: 'Kunlik VIP' },
  { type: 'avatar_frame', weight: 2,  amount: 1, label: 'Eksklyuziv avatar' },
  { type: 'emoji_pack',   weight: 3,  amount: 1, label: 'Emoji pack' },
  { type: 'rank_points',  weight: 2,  amount: RANK_POINT_REWARD, label: 'Reyting ochkolari' },
  { type: 'reroll',       weight: 6,  amount: 1, label: 'Ikkinchi aylantirish' },
  { type: 'empty',        weight: 6,  amount: 0, label: "Bo'sh katak" },
];

export function barabanPrizeWeightTotal() {
  return BARABAN_PRIZES.reduce((sum, prize) => sum + Number(prize.weight || 0), 0);
}

function buildCdf() {
  let cdf = 0;
  return BARABAN_PRIZES.map((prize) => ({ ...prize, cdf: (cdf += prize.weight) }));
}

const CDF = buildCdf();

function rollPrize(randomValue = Math.random()) {
  const total = CDF[CDF.length - 1]?.cdf || 0;
  const roll = Math.max(0, Math.min(0.999999999, Number(randomValue) || 0)) * total;
  return CDF.find((prize) => roll < prize.cdf) || BARABAN_PRIZES[0];
}

async function getBarabanGamesRequired() {
  try {
    const thresholds = await getThresholds();
    return Math.max(0, Number(thresholds.baraban ?? DEFAULT_FREE_SPIN_GAMES_REQUIRED));
  } catch (_) {
    return DEFAULT_FREE_SPIN_GAMES_REQUIRED;
  }
}

function pickRandom(arr) {
  if (!arr.length) return null;
  return arr[Math.floor(Math.random() * arr.length)];
}

const BARABAN_AVATAR_FRAMES = PROFILE_FRAMES.filter((frame) => frame.id !== 'none');
const BARABAN_EMOJI_PACKS = EMOJI_PACKS.filter((pack) => !pack.premium);

function pickCollectionPrize(type) {
  if (type === 'avatar_frame') {
    const frame = pickRandom(BARABAN_AVATAR_FRAMES);
    return frame ? {
      itemType: 'avatar_frame',
      itemId: frame.id,
      label: frame.name,
      rarity: frame.rarity,
      icon: frame.icon,
    } : null;
  }

  if (type === 'emoji_pack') {
    const pack = pickRandom(BARABAN_EMOJI_PACKS);
    return pack ? {
      itemType: 'emoji_pack',
      itemId: pack.id,
      label: pack.name,
      rarity: pack.rarity,
      pack,
    } : null;
  }

  return null;
}

async function grantEmojiPack(client, userId, pack) {
  await client.query(
    `INSERT INTO inventory (user_id, item_type, item_id, quantity)
     VALUES ($1, 'emoji_pack', $2, 1)
     ON CONFLICT (user_id, item_type, item_id)
     DO UPDATE SET quantity = GREATEST(inventory.quantity, 1)`,
    [userId, pack.id]
  );

  for (const emoji of pack.emoji || []) {
    await client.query(
      `INSERT INTO inventory (user_id, item_type, item_id, quantity)
       VALUES ($1, 'emoji', $2, 1)
       ON CONFLICT (user_id, item_type, item_id)
       DO UPDATE SET quantity = inventory.quantity + 1`,
      [userId, `${pack.id}:${emoji.id}`]
    );
  }
}

function publicCollectionItem(collectionPrize) {
  if (!collectionPrize) return null;
  return {
    itemType: collectionPrize.itemType,
    itemId: collectionPrize.itemId,
    label: collectionPrize.label,
    rarity: collectionPrize.rarity,
    icon: collectionPrize.icon,
  };
}

export async function getBarabanStatus(userId) {
  const [gamesR, lastSpinR, requiredGames] = await Promise.all([
    query(
      `SELECT games_played, COALESCE(baraban_extra_spins, 0) AS baraban_extra_spins
         FROM users WHERE id = $1`,
      [userId]
    ),
    query(
      `SELECT created_at FROM baraban_spins WHERE user_id = $1
        ORDER BY created_at DESC LIMIT 1`,
      [userId]
    ),
    getBarabanGamesRequired(),
  ]);

  const gamesPlayed = Number(gamesR.rows[0]?.games_played || 0);
  const extraSpins = Number(gamesR.rows[0]?.baraban_extra_spins || 0);
  const unlocked = gamesPlayed >= requiredGames;
  const lastSpin = lastSpinR.rows[0]?.created_at || null;
  const nowMs = Date.now();
  const lastSpinMs = lastSpin ? new Date(lastSpin).getTime() : 0;
  const msSinceSpin = lastSpin ? nowMs - lastSpinMs : Infinity;
  const cooldownOpen = msSinceSpin >= DAY_MS;
  const canSpin = unlocked && (extraSpins > 0 || cooldownOpen);
  const nextSpinMs = canSpin || extraSpins > 0 ? 0 : Math.max(0, DAY_MS - msSinceSpin);
  const nextSpinAt = lastSpin && !canSpin && extraSpins <= 0
    ? new Date(lastSpinMs + DAY_MS).toISOString()
    : null;

  return {
    unlocked,
    canSpin,
    nextSpinMs,
    nextSpinAt,
    serverTime: new Date(nowMs).toISOString(),
    multiplier: 1,
    extraSpins,
    extra_spins: extraSpins,
    gamesPlayed,
    games_played: gamesPlayed,
    requiredGames,
    required_games: requiredGames,
    lastSpin,
  };
}

export async function spinBaraban(userId) {
  return withTransaction(async (client) => {
    await client.query(
      `SELECT pg_advisory_xact_lock(hashtext($1))`,
      [`baraban:${userId}`]
    );

    const userR = await client.query(
      `SELECT games_played, premium_until, COALESCE(baraban_extra_spins, 0) AS baraban_extra_spins
         FROM users WHERE id = $1 FOR UPDATE`,
      [userId]
    );
    const user = userR.rows[0];
    if (!user) throw Object.assign(new Error('User not found'), { status: 404 });

    const gamesPlayed = Number(user.games_played || 0);
    const requiredGames = await getBarabanGamesRequired();
    if (gamesPlayed < requiredGames) {
      throw Object.assign(
        new Error(`Baraban ${requiredGames} o'yindan keyin ochiladi. Siz: ${gamesPlayed}`),
        { status: 403 }
      );
    }

    const lastSpinR = await client.query(
      `SELECT created_at FROM baraban_spins WHERE user_id = $1
        ORDER BY created_at DESC LIMIT 1`,
      [userId]
    );
    const lastSpin = lastSpinR.rows[0]?.created_at;
    const extraSpinsBefore = Number(user.baraban_extra_spins || 0);
    let usesExtraSpin = false;

    if (lastSpin) {
      const elapsed = Date.now() - new Date(lastSpin).getTime();
      if (elapsed < DAY_MS) {
        if (extraSpinsBefore > 0) {
          usesExtraSpin = true;
        } else {
          const nextMs = Math.ceil(DAY_MS - elapsed);
          throw Object.assign(
            new Error(`Keyingi spin ${Math.ceil(nextMs / 3600000)} soat ${Math.ceil((nextMs % 3600000) / 60000)} daqiqadan keyin`),
            { status: 429, nextSpinMs: nextMs }
          );
        }
      }
    }

    let prize = rollPrize();
    let collectionPrize = pickCollectionPrize(prize.type);
    if ((prize.type === 'avatar_frame' || prize.type === 'emoji_pack') && !collectionPrize) {
      prize = { type: 'coins', weight: 0, amount: 50, label: 'Fallback Durak Dollar' };
      collectionPrize = null;
    }

    const multiplier = 1;
    const baseAmount = Number(prize.amount || 0);
    const finalAmount = collectionPrize ? 1 : baseAmount;

    await client.query(
      `INSERT INTO baraban_spins (user_id, prize_type, prize_amount, multiplier, is_jackpot, prize_item_type, prize_item_id)
       VALUES ($1, $2, $3, $4, FALSE, $5, $6)`,
      [
        userId,
        prize.type,
        finalAmount,
        multiplier,
        collectionPrize?.itemType || null,
        collectionPrize?.itemId || null,
      ]
    );
    await client.query(
      `UPDATE users SET last_baraban_spin = now() WHERE id = $1`,
      [userId]
    ).catch(() => {});

    if (prize.type === 'coins' && finalAmount > 0) {
      await client.query(
        `UPDATE users SET coins = coins + $1 WHERE id = $2`,
        [finalAmount, userId]
      );
      await client.query(
        `INSERT INTO transactions (user_id, amount, type, reference_id, metadata)
         VALUES ($1, $2, 'baraban_prize', NULL, $3)`,
        [userId, finalAmount, JSON.stringify({ prizeType: prize.type, prizeAmount: finalAmount })]
      );
    } else if (prize.type === 'premium_day' && finalAmount > 0) {
      await client.query(
        `UPDATE users
            SET premium_until = GREATEST(COALESCE(premium_until, now()), now()) + ($1 || ' days')::interval
          WHERE id = $2`,
        [finalAmount, userId]
      );
    } else if (prize.type === 'rank_points' && finalAmount > 0) {
      const rankR = await client.query(
        `UPDATE users
            SET bonus_rank_points = COALESCE(bonus_rank_points, 0) + $1,
                rank_wins = rank_wins + $1
          WHERE id = $2
          RETURNING rank_wins`,
        [finalAmount, userId]
      );
      const rank = computeRankFromWins(Number(rankR.rows[0]?.rank_wins || 0));
      await client.query(
        `UPDATE users
            SET rank_color = $1,
                rank_lines = $2,
                rank_pluses = $3,
                rank_progress = $4
          WHERE id = $5`,
        [rank.color, rank.lines, rank.pluses, rank.progress, userId]
      );
    } else if (collectionPrize?.itemType === 'emoji_pack' && collectionPrize.pack) {
      await grantEmojiPack(client, userId, collectionPrize.pack);
    } else if (collectionPrize) {
      await client.query(
        `INSERT INTO inventory (user_id, item_type, item_id, quantity)
         VALUES ($1, $2, $3, 1)
         ON CONFLICT (user_id, item_type, item_id)
         DO UPDATE SET quantity = inventory.quantity + 1`,
        [userId, collectionPrize.itemType, collectionPrize.itemId]
      );
      if (collectionPrize.itemType === 'avatar_frame') {
        await client.query(
          `UPDATE users SET selected_avatar_frame = $1 WHERE id = $2`,
          [collectionPrize.itemId, userId]
        );
      }
    }

    const extraSpinDelta = (prize.type === 'reroll' ? 1 : 0) - (usesExtraSpin ? 1 : 0);
    if (extraSpinDelta !== 0) {
      await client.query(
        `UPDATE users
            SET baraban_extra_spins = GREATEST(0, COALESCE(baraban_extra_spins, 0) + $1)
          WHERE id = $2`,
        [extraSpinDelta, userId]
      );
    }

    const balanceR = await client.query(
      `SELECT coins,
              gold_coins,
              COALESCE(tournament_tickets, 0) AS tournament_tickets,
              premium_until,
              selected_avatar_frame,
              rank_wins,
              rank_color,
              rank_lines,
              rank_pluses,
              rank_progress,
              COALESCE(baraban_extra_spins, 0) AS baraban_extra_spins
         FROM users
        WHERE id = $1`,
      [userId]
    );
    const row = balanceR.rows[0] || {};
    const balances = {
      coins: Number(row.coins || 0),
      gold_coins: Number(row.gold_coins || 0),
      tournament_tickets: Number(row.tournament_tickets || 0),
      premium_until: row.premium_until || null,
      selected_avatar_frame: row.selected_avatar_frame || null,
      rank_wins: Number(row.rank_wins || 0),
      rank_color: row.rank_color || 'white',
      rank_lines: Number(row.rank_lines || 0),
      rank_pluses: Number(row.rank_pluses || 0),
      rank_progress: Number(row.rank_progress || 0),
      baraban_extra_spins: Number(row.baraban_extra_spins || 0),
    };

    return {
      prize_type: prize.type,
      prize_amount: finalAmount,
      multiplier,
      is_jackpot: false,
      base_amount: baseAmount,
      item: publicCollectionItem(collectionPrize),
      balances,
      credited: prize.type !== 'empty',
      extra_spin_used: usesExtraSpin,
      extra_spins: balances.baraban_extra_spins,
      serverConfirmedAt: new Date().toISOString(),
      premiumWheel: true,
    };
  });
}

export async function getSpinHistory(userId) {
  const r = await query(
    `SELECT prize_type, prize_amount, multiplier, is_jackpot, prize_item_type, prize_item_id, created_at
       FROM baraban_spins
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT 10`,
    [userId]
  );
  return r.rows;
}
