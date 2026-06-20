import { withTransaction } from '../db.js';

export const PROFILE_REWARDS = [
  { key: 'first_win_100k', title: 'Birinchi g‘alaba', metric: 'games_won', target: 1, rewardCoins: 100000, stickerPack: 'pack_panda' },
  { key: 'wins_3_bronze', title: '3 g‘alaba', metric: 'games_won', target: 3, rewardCoins: 10000, stickerPack: 'pack_koala' },
  { key: 'wins_5_silver', title: '5 g‘alaba', metric: 'games_won', target: 5, rewardCoins: 25000, stickerPack: 'pack_cool_boy' },
  { key: 'wins_10_gold', title: '10 g‘alaba', metric: 'games_won', target: 10, rewardCoins: 50000, stickerPack: 'pack_lion' },
  { key: 'wins_20_crown', title: '20 g‘alaba', metric: 'games_won', target: 20, rewardCoins: 75000, stickerPack: 'pack_ninja' },
  { key: 'wins_50_trophy', title: '50 g‘alaba', metric: 'games_won', target: 50, rewardCoins: 150000, stickerPack: 'pack_dragon' },
  { key: 'wins_100_legend', title: '100 g‘alaba', metric: 'games_won', target: 100, rewardCoins: 300000, stickerPack: 'pack_legend_queen' },
  { key: 'games_25_drop', title: '25 o‘yin', metric: 'games_played', target: 25, rewardCoins: 15000, stickerPack: 'pack_clown' },
  { key: 'games_100_drop', title: '100 o‘yin', metric: 'games_played', target: 100, rewardCoins: 60000, stickerPack: 'pack_pirate' },
  { key: 'draws_10_medal', title: '10 durang', metric: 'games_draw', target: 10, rewardCoins: 10000, badge: 'draws_10' },
  { key: 'draws_50_medal', title: '50 durang', metric: 'games_draw', target: 50, rewardCoins: 50000, badge: 'draws_50' },
  { key: 'draws_100_medal', title: '100 durang', metric: 'games_draw', target: 100, rewardCoins: 100000, badge: 'draws_100' },
  { key: 'sheriff_5_medal', title: 'Sherif', metric: 'bluffs_caught', target: 5, rewardCoins: 25000, badge: 'sheriff_5' },
  { key: 'sheriff_25_medal', title: 'Katta sherif', metric: 'bluffs_caught', target: 25, rewardCoins: 100000, badge: 'sheriff_25' },
];

export async function grantAvailableProfileRewards(userId, stats = null) {
  return withTransaction(async (client) => {
    // One reward grant pipeline per user at a time. This prevents double
    // profile_reward credits if game-end and profile-open race each other.
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`profile_rewards:${userId}`]);

    let row = stats;
    if (!row) {
      const r = await client.query(
        `SELECT games_won, games_played, games_draw, bluffs_caught FROM users WHERE id = $1 FOR UPDATE`,
        [userId]
      );
      row = r.rows[0] || {};
    } else {
      await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [userId]);
    }

    const granted = [];
    for (const reward of PROFILE_REWARDS) {
      const value = Number(row[reward.metric] || 0);
      if (value < reward.target) continue;
      const exists = await client.query(
        `SELECT 1 FROM transactions
          WHERE user_id = $1
            AND type = 'profile_reward'
            AND metadata->>'rewardKey' = $2
          LIMIT 1`,
        [userId, reward.key]
      );
      if (exists.rows[0]) continue;

      await client.query('UPDATE users SET coins = coins + $1 WHERE id = $2', [reward.rewardCoins, userId]);
      await client.query(
        `INSERT INTO transactions (user_id, amount, type, metadata)
         VALUES ($1, $2, 'profile_reward', $3)`,
        [userId, reward.rewardCoins, { rewardKey: reward.key, title: reward.title }]
      );
      if (reward.stickerPack) {
        await client.query(
          `INSERT INTO inventory (user_id, item_type, item_id, quantity)
           VALUES ($1, 'sticker_pack', $2, 1)
           ON CONFLICT (user_id, item_type, item_id)
           DO UPDATE SET quantity = inventory.quantity + 1`,
          [userId, reward.stickerPack]
        );
      }
      if (reward.badge) {
        await client.query(
          `INSERT INTO inventory (user_id, item_type, item_id, quantity)
           VALUES ($1, 'badge', $2, 1)
           ON CONFLICT (user_id, item_type, item_id)
           DO UPDATE SET quantity = inventory.quantity + 1`,
          [userId, reward.badge]
        );
      }
      granted.push(reward.key);
    }
    return granted;
  });
}

export function progressReward(reward, stats, claimedKeys) {
  const value = Number(stats[reward.metric] || 0);
  return {
    ...reward,
    current: value,
    progress: Math.max(0, Math.min(100, Math.round((value / reward.target) * 100))),
    unlocked: value >= reward.target,
    claimed: claimedKeys.has(reward.key),
  };
}
