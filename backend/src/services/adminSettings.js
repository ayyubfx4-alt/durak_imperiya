import { query } from '../db.js';

export const DEFAULT_ADMIN_SETTINGS = {
  fake_bots: { enabled: false, count: 0, level: 'easy' },
  fake_donations: { enabled: false, countPerHour: 0 },
  maintenance: { enabled: false, message: '' },
  game_config: {
    startingCards: 6,
    maxPlayersPerRoom: 6,
    allowBots: true,
    voiceChat: true,
    turnTimeLimit: 30,
  },
  antibot: { enabled: true, sensitivity: 5 },
};

export async function getAdminSetting(key) {
  const r = await query('SELECT value FROM admin_settings WHERE key = $1', [key]);
  return r.rows[0]?.value ?? DEFAULT_ADMIN_SETTINGS[key] ?? {};
}

export async function getGameConfigSetting() {
  return { ...DEFAULT_ADMIN_SETTINGS.game_config, ...(await getAdminSetting('game_config')) };
}

export async function isVoiceChatEnabled() {
  const gameConfig = await getGameConfigSetting();
  return gameConfig.voiceChat !== false;
}
