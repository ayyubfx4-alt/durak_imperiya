// Achievement keys, thresholds, names, and unlock logic.
export const ACHIEVEMENTS = [
  // Win streaks
  { key: 'streak_win_10', name: '10 Win Streak', category: 'streak', target: 10 },
  { key: 'streak_win_20', name: '20 Win Streak', category: 'streak', target: 20 },
  { key: 'streak_win_50', name: '50 Win Streak', category: 'streak', target: 50 },
  { key: 'streak_win_100', name: '100 Win Streak', category: 'streak', target: 100 },
  // Loss streaks (humorous)
  { key: 'brave_loser_10', name: 'Brave Loser', category: 'lossStreak', target: 10 },
  { key: 'brave_loser_20', name: '20 Loss Streak', category: 'lossStreak', target: 20 },
  { key: 'pro_durak_50', name: 'Professional Durak', category: 'lossStreak', target: 50 },
  // Coin milestones
  { key: 'coins_300', name: '300 Coins', category: 'coins', target: 300 },
  { key: 'coins_1k', name: '1,000 Coins', category: 'coins', target: 1000 },
  { key: 'coins_10k', name: '10,000 Coins', category: 'coins', target: 10000 },
  { key: 'coins_100k', name: '100,000 Coins', category: 'coins', target: 100000 },
  { key: 'coins_1m', name: '1,000,000 Coins', category: 'coins', target: 1000000 },
  // Friends
  { key: 'friends_10', name: '10 Friends', category: 'friends', target: 10 },
  { key: 'friends_50', name: '50 Friends', category: 'friends', target: 50 },
  { key: 'friends_100', name: '100 Friends', category: 'friends', target: 100 },
  // Games played
  { key: 'games_50', name: '50 Games Played', category: 'games', target: 50 },
  { key: 'games_100', name: '100 Games Played', category: 'games', target: 100 },
  { key: 'games_500', name: '500 Games Played', category: 'games', target: 500 },
  { key: 'games_1k', name: '1,000 Games Played', category: 'games', target: 1000 },
  { key: 'games_10k', name: '10,000 Games Played', category: 'games', target: 10000 },
  // Total wins
  { key: 'wins_50', name: '50 Wins', category: 'wins', target: 50 },
  { key: 'wins_100', name: '100 Wins', category: 'wins', target: 100 },
  { key: 'wins_150', name: '150 Wins', category: 'wins', target: 150 },
  { key: 'wins_500', name: '500 Wins', category: 'wins', target: 500 },
  { key: 'wins_1000', name: '1,000 Wins', category: 'wins', target: 1000 },
  { key: 'wins_5000', name: '5,000 Wins', category: 'wins', target: 5000 },
  { key: 'wins_10000', name: '10,000 Wins', category: 'wins', target: 10000 },
  // Draws
  { key: 'draws_10', name: '10 Draws', category: 'draws', target: 10 },
  { key: 'draws_50', name: '50 Draws', category: 'draws', target: 50 },
  { key: 'draws_100', name: '100 Draws', category: 'draws', target: 100 },
  // Bluff catcher
  { key: 'sheriff_5', name: 'Sheriff Badge', category: 'bluffsCaught', target: 5 },
  { key: 'sheriff_25', name: 'Master Sheriff', category: 'bluffsCaught', target: 25 },
];

export const ACHIEVEMENT_BY_KEY = Object.fromEntries(ACHIEVEMENTS.map((a) => [a.key, a]));

export function unlockedFromStats(stats) {
  // stats: { winStreak, lossStreak, coins, friends, gamesPlayed, gamesWon, draws, bluffsCaught }
  const out = [];
  for (const a of ACHIEVEMENTS) {
    let value = 0;
    switch (a.category) {
      case 'streak': value = stats.winStreak || 0; break;
      case 'lossStreak': value = stats.lossStreak || 0; break;
      case 'coins': value = stats.coins || 0; break;
      case 'friends': value = stats.friends || 0; break;
      case 'games': value = stats.gamesPlayed || 0; break;
      case 'wins': value = stats.gamesWon || 0; break;
      case 'draws': value = stats.draws || 0; break;
      case 'bluffsCaught': value = stats.bluffsCaught || 0; break;
    }
    if (value >= a.target) out.push(a.key);
  }
  return out;
}
