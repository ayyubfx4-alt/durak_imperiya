import { createGame, playAttack, playDefense, takeCards, passAttack, challengeBluff, transferAttack, viewFor, forfeit } from './engine.js';
import { botDecide } from './bot.js';
import { pickThinkDelay, maybeBotChat, botEmojiFor } from './botTyping.js';
import { pickBotName } from '../data/botNames.js';
import { acquireBot, releaseBot } from './botPool.js';
import { config, isValidBetTier } from '../config.js';
import { randomCode, uuid } from '../util/random.js';
import { query, withTransaction } from '../db.js';
import { changeCoins } from '../services/coins.js';
import { rollRandomEmoji } from '../data/emojiPacks.js';
import { checkAndUnlock } from '../services/achievements.js';
import { maybePayReferralBonus } from '../services/referral.js';
import { computeRankFromWins } from '../services/rank.js';
import { syncManyUserGameStats } from '../services/gameStats.js';
import { grantAvailableProfileRewards } from '../services/profileRewards.js';
import { recordGameMetrics } from '../services/antibot.js';
import { recordMatchResult } from '../services/tournamentEngine.js';
import { recordUnlocksForGamesPlayed } from '../services/progression.js';
import { logger } from '../logger.js';
import { unregisterRoom } from '../scaling/redisAdapter.js';

/**
 * RoomManager — keeps live rooms in memory, handles seating, bot fill, and game lifecycle.
 * Persists final results to the database. Single-process MVP. For horizontal scaling,
 * back this with Redis pub/sub + sticky-session sockets.
 */

export class RoomManager {
  constructor(io) {
    this.io = io;
    /** @type {Map<string, Room>} */
    this.rooms = new Map();
  }

  createRoom(opts) {
    const code = opts.code || randomCode(6);
    const room = new Room(this, code, opts);
    this.rooms.set(code, room);
    return room;
  }

  get(code) { return this.rooms.get(code); }

  destroy(code) {
    const r = this.rooms.get(code);
    if (r) r.cleanup();
    this.rooms.delete(code);
    this.broadcastPublicList();
  }

  broadcastPublicList() {
    this.io?.emit?.('rooms:list', this.publicList());
  }

  /**
   * Public lobby list — returned to anonymous and authenticated clients alike.
   *
   * The TOR §3 requires that we surface the number of real players seated at
   * each table so the player can pick a table populated mostly by humans.
   * Bot identities are hidden (they look like normal seats to the viewer).
   */
  publicList() {
    return Array.from(this.rooms.values())
      .filter((r) => r.state.phase === 'lobby')
      .map((r) => ({
        code: r.code,
        host: r.host?.username,
        maxPlayers: r.maxPlayers,
        seats: r.seats.map((s) => s ? { id: s.id, username: s.username, ready: s.ready, avatarColor: s.avatarColor, avatarLines: s.avatarLines, avatarPluses: s.avatarPluses, rankWins: s.rankWins } : null),
        taken: r.seats.filter(Boolean).length,
        realCount: r.seats.filter((s) => s && !s.isBot).length,
        stake: r.stake,
        bluffEnabled: r.bluffEnabled,
        isPrivate: r.isPrivate,
        hasPassword: !!r.password,
        deckSize: r.deckSize,
        turnSeconds: Math.round(r.turnTimeoutMs / 1000),
        transferEnabled: r.transferEnabled,
        throwInMode: r.throwInMode,
        allowDraw: r.allowDraw,
        mode: r.mode,
      }));
  }
}

export class Room {
  constructor(manager, code, opts) {
    this.manager = manager;
    this.code = code;
    const requested = Math.floor(opts.maxPlayers || 2);
    if (!config.game.allowedTableSizes.includes(requested)) {
      throw Object.assign(new Error('table size must be one of ' + config.game.allowedTableSizes.join(', ')), { status: 400 });
    }
    this.maxPlayers = requested;
    this.mode = opts.mode || 'classic';
    // TOR §4.1: stakes must be one of the discrete bet tiers.
    const stake = this.mode === 'tournament' ? 0 : Math.floor(opts.stake || config.game.minBet);
    if (this.mode !== 'tournament' && !isValidBetTier(stake)) {
      throw Object.assign(new Error('stake must be one of the allowed bet tiers'), { status: 400 });
    }
    this.stake = stake;
    this.bluffEnabled = !!opts.bluffEnabled;
    this.isPrivate = !!opts.isPrivate;
    this.password = this.isPrivate ? String(opts.password || '').slice(0, 24) : '';
    this.deckSize = [24, 36, 52].includes(Number(opts.deckSize)) ? Number(opts.deckSize) : 36;
    this.turnTimeoutMs = Number(opts.turnSeconds) === 15 ? 15_000 : 30_000;
    this.transferEnabled = !!opts.transferEnabled;
    this.throwInMode = opts.throwInMode === 'all' ? 'all' : 'neighbor';
    this.allowDraw = opts.allowDraw !== false;
    this.host = opts.host || null;
    this.botLevel = opts.botLevel || 'medium';

    /** @type {Array<{id, username, isBot, botLevel, socketId, ready, joinedAt}>} */
    this.seats = Array.from({ length: this.maxPlayers }, () => null);
    this.state = { phase: 'lobby' };
    this.gameState = null;
    this.botFillTimer = null;
    this.quickStartTimer = null;
    this.turnTimer = null;
    this.botActionTimer = null;
    this.botTypingTimers = [];
    this.snapshotTimer = null;
    this.chatBuffer = [];
    this.tournamentMatch = opts.tournamentMatch || null;
    this.spectators = new Map();
    this.createdAt = Date.now();
    this.turnDeadline = null;
    this.starting = false;
    this._finishing = false;
    this.stakeChargedHumanIds = [];
    this.humanActionStats = new Map();
    this.invitedUserIds = new Set();
    // Auto-fill any empty seats with bots after the configured timeout.
    if (!this.isPrivate) this.armBotFillTimer();
  }

  grantInvite(userId) {
    if (userId) this.invitedUserIds.add(String(userId));
  }

  hasInvite(userId) {
    return Boolean(userId && this.invitedUserIds.has(String(userId)));
  }

  join(player, password = '') {
    const existingIdx = this.seats.findIndex((s) => s && s.id === player.id);
    if (existingIdx !== -1) {
      this.seats[existingIdx] = { ...this.seats[existingIdx], ...player, isBot: false };
      this.broadcastLobby();
      return { ok: true, seatIdx: existingIdx, alreadyJoined: true };
    }
    const invited = this.hasInvite(player.id);
    if (this.isPrivate && this.password && !invited && String(password || '') !== this.password) {
      return { ok: false, error: 'wrong password' };
    }
    let seatIdx = this.seats.findIndex((s) => !s);
    // TOR §3: when a real player joins and there are no empty seats, evict
    // the first bot we find so the human always wins the seat.
    if (seatIdx === -1) {
      const botSeat = this.seats.findIndex((s) => s && s.isBot);
      if (botSeat === -1) return { ok: false, error: 'room full' };
      releaseBot(this.seats[botSeat].id).catch(() => {});
      this.seats[botSeat] = null;
      seatIdx = botSeat;
    }
    this.seats[seatIdx] = { ...player, isBot: false, ready: false, joinedAt: Date.now() };
    if (!this.host) this.host = this.seats[seatIdx];
    this.cancelBotFillTimer();
    if (!this.isPrivate) this.armBotFillTimer();
    this.broadcastLobby();
    return { ok: true, seatIdx };
  }

  leave(playerId) {
    const idx = this.seats.findIndex((s) => s && s.id === playerId);
    if (idx === -1) return false;
    const leavingSeat = this.seats[idx];
    this.seats[idx] = null;
    if (this.host?.id === playerId) {
      // TOR §18: Host migration — pick the next seated player as host and
      // broadcast room:host_changed so all clients can update their UI.
      this.host = this.seats.find(Boolean) || null;
      if (this.host) {
        this.manager.io.to(`room:${this.code}`).emit('room:host_changed', {
          newHostId: this.host.id,
          newHostUsername: this.host.username,
        });
      }
    }
    if (this.seats.every((s) => !s)) {
      this.manager.destroy(this.code);
      return true;
    }
    if (this.state.phase === 'playing' && this.gameState?.phase !== 'ended') {
      this.forfeitPlayer(leavingSeat.id, 'left_game');
    } else {
      this.cancelBotFillTimer();
      if (!this.isPrivate) this.armBotFillTimer();
      this.broadcastLobby();
    }
    return true;
  }

  async forfeitPlayer(playerId, reason = 'forfeit') {
    if (!this.gameState || this.gameState.phase === 'ended') return false;
    const result = forfeit(this.gameState, playerId, reason);
    if (!result.ok) {
      logger.warn('forfeitPlayer failed: %s', result.error);
      return false;
    }
    this.gameState.forfeit = { playerId, reason, at: Date.now() };
    this.broadcastGameState('game:forfeit');
    await this.finishGame({ forfeitedPlayerId: playerId, forfeitReason: reason });
    return true;
  }

  async replaceWithBot(seatIdx) {
    const taken = new Set(this.seats.filter(Boolean).map((s) => s.username));
    let bot;
    try {
      bot = await acquireBot({ excludeUsernames: taken });
    } catch (e) {
      logger.warn('acquireBot failed, using fallback name: %s', e.message);
      bot = {
        id: `bot-${uuid()}`,
        username: pickBotName(taken),
        botLevel: this.botLevel,
        rankWins: 0,
        avatarColor: 'gray',
        avatarLines: 0,
        avatarPluses: 0,
      };
    }
    this.seats[seatIdx] = {
      id: bot.id,
      username: bot.username,
      isBot: true,
      botLevel: bot.botLevel || this.botLevel,
      rankWins: bot.rankWins,
      avatarColor: bot.avatarColor,
      avatarLines: bot.avatarLines,
      avatarPluses: bot.avatarPluses,
      socketId: null,
      ready: true,
      joinedAt: Date.now(),
    };
    this.broadcastLobby();
    this.maybeScheduleBotAction();
  }

  armBotFillTimer() {
    if (this.isPrivate) {
      this.cancelBotFillTimer();
      return;
    }
    if (this.state.phase !== 'lobby') return;
    if (this.botFillTimer) return;
    if (!this.seats.some((s) => !s)) return;
    this.botFillTimer = setTimeout(() => {
      this.botFillTimer = null;
      if (this.state.phase === 'lobby' && this.seats.some((s) => !s)) {
        logger.debug(`bot-fill timer fired for room ${this.code}`);
        this.fillWithBots();
      }
    }, config.game.botFillTimeoutMs);
  }

  cancelBotFillTimer() {
    if (this.botFillTimer) {
      clearTimeout(this.botFillTimer);
      this.botFillTimer = null;
    }
  }

  cancelQuickStartTimer() {
    if (this.quickStartTimer) {
      clearTimeout(this.quickStartTimer);
      this.quickStartTimer = null;
    }
  }

  armQuickStartTimer() {
    if (this.isPrivate) return;
    if (this.state.phase !== 'lobby' || this.quickStartTimer) return;
    const humans = this.seats.filter((s) => s && !s.isBot);
    const hasEmptySeats = this.seats.some((s) => !s);
    const allHumansReady = humans.length > 0 && humans.every((s) => s.ready || s.id === this.host?.id);
    if (!hasEmptySeats || !allHumansReady || !this.host) return;
    this.quickStartTimer = setTimeout(async () => {
      this.quickStartTimer = null;
      if (this.state.phase !== 'lobby') return;
      const liveHumans = this.seats.filter((s) => s && !s.isBot);
      const stillReady = liveHumans.length > 0 && liveHumans.every((s) => s.ready || s.id === this.host?.id);
      if (!stillReady || !this.seats.some((s) => !s)) return;
      logger.debug(`quick-start filled bots for room ${this.code}`);
      await this.requestStart(this.host.id);
    }, 900);
  }

  async fillWithBots({ startAfterFill = false } = {}) {
    if (this.isPrivate) {
      this.cancelBotFillTimer();
      return { ok: false, error: "Stol yopiq. Avval stolni oching." };
    }
    const taken = new Set(this.seats.filter(Boolean).map((s) => s.username));
    for (let i = 0; i < this.seats.length; i++) {
      if (!this.seats[i]) {
        let bot;
        try {
          bot = await acquireBot({ excludeUsernames: taken });
        } catch (e) {
          logger.warn('acquireBot failed, using fallback name: %s', e.message);
          bot = {
            id: `bot-${uuid()}`,
            username: pickBotName(taken),
            botLevel: this.botLevel,
            rankWins: 0,
            avatarColor: 'gray',
            avatarLines: 0,
            avatarPluses: 0,
          };
        }
        taken.add(bot.username);
        this.seats[i] = {
          id: bot.id,
          username: bot.username,
          isBot: true,
          botLevel: bot.botLevel || this.botLevel,
          rankWins: bot.rankWins,
          avatarColor: bot.avatarColor,
          avatarLines: bot.avatarLines,
          avatarPluses: bot.avatarPluses,
          socketId: null,
          ready: true,
          joinedAt: Date.now(),
        };
      }
    }
    this.broadcastLobby();
    if (startAfterFill) void this.startGame();
    return { ok: true };
  }

  setReady(playerId, ready) {
    const seat = this.seats.find((s) => s && s.id === playerId);
    if (!seat) return false;
    seat.ready = !!ready;
    if (!seat.ready) this.cancelQuickStartTimer();
    this.broadcastLobby();
    if (seat.ready) this.armQuickStartTimer();
    return true;
  }

  async requestStart(playerId) {
    if (this.state.phase !== 'lobby') return { ok: false, error: 'already started' };
    if (this.host?.id !== playerId) return { ok: false, error: 'only host can start' };
    if (!this.seats.some(Boolean)) return { ok: false, error: 'no players' };
    if (this.isPrivate && this.seats.some((s) => !s)) {
      return { ok: false, error: "Stol yopiq. Avval do'stingizni taklif qiling yoki stolni oching." };
    }
    if (!this.isPrivate && this.seats.some((s) => !s)) await this.fillWithBots({ startAfterFill: false });
    const humans = this.seats.filter((s) => s && !s.isBot);
    if (humans.length && humans.some((s) => !s.ready && s.id !== playerId)) {
      return { ok: false, error: 'players are not ready' };
    }
    await this.startGame();
    return { ok: this.state.phase === 'playing' };
  }

  async chargeHumanStakes() {
    const humans = this.seats.filter((s) => s && !s.isBot);
    const ids = humans.map((p) => p.id);
    if (this.mode === 'tournament') return ids;
    if (!ids.length) return [];
    return withTransaction(async (client) => {
      const locked = await client.query(
        'SELECT id, coins FROM users WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE',
        [ids]
      );
      const byId = new Map(locked.rows.map((r) => [r.id, Number(r.coins)]));
      const short = ids.find((id) => (byId.get(id) ?? -1) < this.stake);
      if (short) {
        const seat = humans.find((p) => p.id === short);
        throw Object.assign(new Error(`${seat?.username || 'player'} has insufficient coins`), { status: 400 });
      }
      for (const id of ids) {
        await client.query('UPDATE users SET coins = coins - $1 WHERE id = $2', [this.stake, id]);
        await client.query(
          `INSERT INTO transactions (user_id, amount, type, metadata)
           VALUES ($1, $2, 'stake_reserve', $3)`,
          [id, -this.stake, { roomCode: this.code, stake: this.stake }]
        );
      }
      return ids;
    });
  }

  emitUserStatsDirty(reason, userIds = this.seats.filter((s) => s && !s.isBot).map((s) => s.id)) {
    const ids = [...new Set((userIds || []).filter(Boolean).map(String))];
    if (!ids.length) return;
    this.manager.io.emit('user:stats-dirty', {
      reason,
      code: this.code,
      userIds: ids,
      at: Date.now(),
    });
  }

  async startGame() {
    if (this.state.phase !== 'lobby' || this.starting) return;
    this.starting = true;
    this.cancelBotFillTimer();
    try {
      this.stakeChargedHumanIds = await this.chargeHumanStakes();
      this.emitUserStatsDirty('stake-reserve', this.stakeChargedHumanIds);
    } catch (err) {
      this.starting = false;
      this.seats.forEach((s) => { if (s && !s.isBot) s.ready = false; });
      this.manager.io.to(`room:${this.code}`).emit('room:error', { error: err.message || 'stake reservation failed' });
      this.broadcastLobby();
      if (!this.isPrivate) this.armBotFillTimer();
      return;
    }
    this.gameState = createGame({
      players: this.seats.map((s) => ({ id: s.id, username: s.username, isBot: s.isBot, botLevel: s.botLevel })),
      mode: this.mode,
      bluffEnabled: this.bluffEnabled,
      stake: this.stake,
      deckSize: this.deckSize,
      transferEnabled: this.transferEnabled,
      throwInMode: this.throwInMode,
      allowDraw: this.allowDraw,
    });
    this.humanActionStats = new Map(
      this.seats
        .filter((s) => s && !s.isBot)
        .map((s) => [s.id, { actions: 0, totalTurnMs: 0, actionTypes: {} }])
    );
    this.state.phase = 'playing';
    this.manager.broadcastPublicList();
    this.broadcastGameState('game:start');
    this.armTurnTimer();
    this.armSnapshotTimer();
    this.maybeScheduleBotAction();
    this.starting = false;
  }

  /**
   * Periodically persist the live game state to the DB so an operator can inspect
   * orphaned games after a restart. We do NOT attempt to restore from these snapshots
   * — reconstructing the in-memory bot/turn timers is too fragile. On startup the
   * server simply logs that any previously-active games were lost.
   */
  armSnapshotTimer() {
    if (this.snapshotTimer) clearInterval(this.snapshotTimer);
    this.snapshotTimer = setInterval(
      () => this.snapshot().catch((e) => logger.warn('snapshot failed', e.message)),
      60_000
    );
  }

  /**
   * Return a sanitized copy of gameState safe to write to the DB.
   * Strips bot flags (TOR §3: bots must be indistinguishable) and clears
   * raw hand arrays so card data is not persisted in plain JSONB.
   */
  sanitizeStateForDB() {
    if (!this.gameState) return null;
    return {
      ...this.gameState,
      // Convert Set → Array so JSON.stringify works correctly.
      pendingDoneFromAttackers: [...(this.gameState.pendingDoneFromAttackers || [])],
      players: this.gameState.players.map((p) => ({
        ...p,
        isBot: false,     // TOR §3: never reveal bot identity
        botLevel: null,
        hand: [],         // don't persist raw cards in DB
      })),
    };
  }

  async snapshot() {
    if (!this.gameState || this.state.phase !== 'playing') return;
    await query(
      `INSERT INTO games (id, room_code, mode, bluff_enabled, stake, player_ids, bot_slots, final_state, started_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, to_timestamp($9 / 1000.0))
       ON CONFLICT (id) DO UPDATE SET final_state = EXCLUDED.final_state`,
      [
        this.gameState.id,
        this.code,
        this.mode,
        this.bluffEnabled,
        this.stake,
        this.gameState.players.filter((p) => !p.isBot).map((p) => p.id),
        this.gameState.players.filter((p) => p.isBot).length,
        this.sanitizeStateForDB(),
        this.gameState.startedAt,
      ]
    );
  }

  armTurnTimer() {
    if (this.turnTimer) clearTimeout(this.turnTimer);
    this.turnDeadline = Date.now() + this.turnTimeoutMs;
    this.turnTimer = setTimeout(() => this.handleTurnTimeout(), this.turnTimeoutMs);
  }

  /**
   * TOR §2: A player who fails to act within 30 seconds forfeits the game.
   *   • 2-player: the forfeiter becomes the durak, opponent wins the pot.
   *   • 3 / 4 / 6-player: forfeiter is durak; remaining players split the
   *     forfeiter's stake (see finishGame).
   *
   * Bots never time out — they always have a valid auto-move queued, so this
   * only fires for unresponsive humans.
   */
  handleTurnTimeout() {
    if (!this.gameState || this.gameState.phase === 'ended') return;
    const idx = this.gameState.phase === 'defending' ? this.gameState.defenderIdx : this.gameState.attackerIdx;
    const player = this.gameState.players[idx];
    if (!player) return;

    if (player.isBot) {
      const decision = botDecide(this.gameState, idx, player.botLevel || 'medium');
      if (decision.action === 'attack') {
        playAttack(this.gameState, player.id, decision.card);
      } else if (decision.action === 'defense') {
        playDefense(this.gameState, player.id, decision.card);
      } else if (decision.action === 'take') {
        takeCards(this.gameState, player.id);
      } else {
        passAttack(this.gameState, player.id);
      }
      this.emitSpeechFor(player.id, decision.action);
      this.broadcastGameState('game:timeout');
      if (this.gameState.phase === 'ended') return this.finishGame();
      this.armTurnTimer();
      this.maybeScheduleBotAction();
      return;
    }

    forfeit(this.gameState, player.id, 'turn_timeout');
    this.broadcastGameState('game:timeout');
    this.finishGame({ forfeitedPlayerId: player.id });
  }

  maybeScheduleBotAction() {
    if (this.botActionTimer) clearTimeout(this.botActionTimer);
    for (const timer of this.botTypingTimers) clearTimeout(timer);
    this.botTypingTimers = [];
    if (!this.gameState || this.gameState.phase === 'ended') return;
    const idx = this.gameState.phase === 'defending' ? this.gameState.defenderIdx : this.gameState.attackerIdx;
    const player = this.gameState.players[idx];
    if (!player || !player.isBot) return;
    // PRO: Human-like "thinking" delay so bots feel real (TOR §3).
    const actionKind = this.gameState.phase === 'defending' ? 'defense' : 'attack';
    const delay = pickThinkDelay(player.botLevel || 'medium', actionKind);
    // Emit a "player:typing" indicator partway through so the UI shows the
    // exact same "..." animation it shows for humans.
    this.botTypingTimers.push(setTimeout(() => {
      if (!this.gameState || this.gameState.phase === 'ended') return;
      this.manager.io.to(`room:${this.code}`).emit('player:typing', { playerId: player.id, typing: true });
    }, Math.max(150, delay * 0.25)));
    this.botTypingTimers.push(setTimeout(() => {
      this.manager.io.to(`room:${this.code}`).emit('player:typing', { playerId: player.id, typing: false });
    }, Math.max(220, delay - 80)));
    this.botActionTimer = setTimeout(() => this.runBotAction(idx), delay);
  }

  runBotAction(idx) {
    if (!this.gameState || this.gameState.phase === 'ended') return;
    const player = this.gameState.players[idx];
    const decision = botDecide(this.gameState, idx, player.botLevel || 'medium');
    let event = 'game:move';
    let res = { ok: true };
    if (decision.action === 'attack') {
      res = playAttack(this.gameState, player.id, decision.card);
    } else if (decision.action === 'defense') {
      res = playDefense(this.gameState, player.id, decision.card);
    } else if (decision.action === 'transfer') {
      res = transferAttack(this.gameState, player.id, decision.card);
    } else if (decision.action === 'take') {
      res = takeCards(this.gameState, player.id);
    } else if (decision.action === 'pass') {
      // Simulate other bot/human attackers also passing
      res = passAttack(this.gameState, player.id);
    }
    if (!res?.ok) {
      res = this.gameState.defenderIdx === idx
        ? takeCards(this.gameState, player.id)
        : passAttack(this.gameState, player.id);
      decision.action = this.gameState.defenderIdx === idx ? 'take' : 'pass';
    }
    this.emitSpeechFor(player.id, decision.action);
    // PRO: occasionally bot "chats" or sends an emoji — looks human.
    try {
      const chat = maybeBotChat();
      if (chat) {
        this.manager.io.to(`room:${this.code}`).emit('chat:message', {
          playerId: player.id,
          username: player.username,
          text: chat,
          ts: Date.now(),
        });
      }
      const emoji = botEmojiFor(decision.action === 'take' ? 'take' : null);
      if (emoji) {
        this.manager.io.to(`room:${this.code}`).emit('emoji:react', {
          playerId: player.id, emoji, ts: Date.now(),
        });
      }
    } catch (_) { /* non-fatal */ }
    this.broadcastGameState(event);
    if (this.gameState.phase === 'ended') return this.finishGame();
    this.armTurnTimer();
    this.maybeScheduleBotAction();
  }

  applyAction(playerId, action, payload) {
    if (!this.gameState || this.gameState.phase === 'ended') return { ok: false, error: 'no game' };
    let res;
    switch (action) {
      case 'attack': res = playAttack(this.gameState, playerId, payload?.card, { bluff: !!payload?.bluff, claimedRank: payload?.claimedRank }); break;
      case 'defense': res = playDefense(this.gameState, playerId, payload?.card); break;
      case 'transfer': res = transferAttack(this.gameState, playerId, payload?.card); break;
      case 'take': res = takeCards(this.gameState, playerId); break;
      case 'pass': res = passAttack(this.gameState, playerId); break;
      case 'challenge': res = challengeBluff(this.gameState, playerId, payload?.tableIdx); break;
      default: return { ok: false, error: 'unknown action' };
    }
    if (!res.ok) return res;
    const actorStats = this.humanActionStats.get(playerId);
    if (actorStats) {
      actorStats.actions += 1;
      actorStats.totalTurnMs += Math.max(0, this.turnTimeoutMs - Math.max(0, (this.turnDeadline || Date.now()) - Date.now()));
      actorStats.actionTypes[action] = (actorStats.actionTypes[action] || 0) + 1;
    }
    // Emit a speech bubble so other players see what the actor did. Bots
    // get their speech from runBotAction; humans get it here. The chat
    // bubble UI listens for `player:speech`.
    this.emitSpeechFor(playerId, action);
    this.broadcastGameState('game:move');
    if (this.gameState.phase === 'ended') { this.finishGame(); }
    else { this.armTurnTimer(); this.maybeScheduleBotAction(); }
    return res;
  }

  /**
   * Broadcast a transient "speech bubble" hint to all sockets in the room.
   * The client renders this for ~1.5s above the actor's avatar (see
   * web-client/public/src/pages/game.js → `player:speech`).
   *
   * Maps engine actions → i18n speech keys:
   *   attack/defense/take  → the action name itself
   *   pass                 → "pass"
   *   defense (all beaten) → "defended"
   *
   * Silently ignored if the speech cannot be inferred.
   */
  emitSpeechFor(playerId, action) {
    let kind = null;
    switch (action) {
      case 'attack':
        kind = 'attack';
        break;
      case 'defense':
        // When the defender beats the final unbeaten card, surface
        // "defended" so the bubble matches the visible state.
        kind = this.gameState?.table?.every?.((t) => t.defense) ? 'defended' : 'attack';
        break;
      case 'take':
        kind = 'take';
        break;
      case 'pass':
        kind = 'pass';
        break;
      default:
        return;
    }
    if (!kind) return;
    this.manager.io.to(`room:${this.code}`).emit('player:speech', { playerId, kind });
  }

  async finishGame(opts = {}) {
    // Guard: finishGame ikki marta chaqirilishining oldini olish.
    // forfeitPlayer + handleTurnTimeout bir vaqtda async zanjir yaratishi mumkin.
    if (this._finishing) return;
    this._finishing = true;

    if (this.turnTimer) { clearTimeout(this.turnTimer); this.turnTimer = null; }
    if (this.botActionTimer) { clearTimeout(this.botActionTimer); this.botActionTimer = null; }
    if (this.snapshotTimer) { clearInterval(this.snapshotTimer); this.snapshotTimer = null; }
    this.state.phase = 'ended';

    const winners = this.gameState.winnerOrder; // ids in order they emptied hand
    const durakId = this.gameState.durakId;
    const isDraw = !durakId && winners.length === this.gameState.players.length;
    const forfeitedPlayerId = opts.forfeitedPlayerId || null;

    const allHumans = this.gameState.players.filter((p) => !p.isBot);
    const allPlayers = this.gameState.players; // includes bots
    const stake = this.stake;
    const firstWinnerId = winners[0];
    const pot = stake * allPlayers.length;
    const payoutShares = [];
    this.gameState.pot = pot;
    this.gameState.payoutShares = payoutShares;
    if (forfeitedPlayerId) {
      this.gameState.forfeit = this.gameState.forfeit || {
        playerId: forfeitedPlayerId,
        reason: opts.forfeitReason || 'forfeit',
        at: Date.now(),
      };
    }

    try {
      // TOR §3: Charge the stake from every human player.
      // Bot seats are handled as virtual debits — the server funds their
      // portion so the winner always receives the full (seats × stake) pot.
      // (Stakeni chargeHumanStakes() startGame() ichida allaqachon olgan,
      //  bu yerda qayta olish kerak emas — Bug 5/6 fix: bo'sh loop o'chirildi)

      // TOR §3: pot = stake × total seats (humans + bots).
      // Bot seats contribute a virtual stake so the winner receives the same
      // payout regardless of how many human-filled seats there are.
      const winnerHumans = allPlayers.filter((p) => !p.isBot && p.id !== forfeitedPlayerId && winners.includes(p.id));
      if (isDraw) {
        for (const id of this.stakeChargedHumanIds) {
          try { await changeCoins(id, stake, 'stake_refund', null, { roomCode: this.code, reason: 'draw' }); }
          catch (e) { logger.warn('stake refund failed', e.message); }
        }
      } else if (forfeitedPlayerId) {
        if (!winnerHumans.length) {
          logger.info('forfeit payout skipped: no human survivor', {
            roomCode: this.code,
            forfeitedPlayerId,
          });
        } else {
          const share = Math.floor(pot / winnerHumans.length);
          let remainder = pot - (share * winnerHumans.length);
          for (const w of winnerHumans) {
            const amount = share + (remainder > 0 ? 1 : 0);
            remainder = Math.max(0, remainder - 1);
            payoutShares.push({ playerId: w.id, amount });
            try { await changeCoins(w.id, amount, 'win', null, { roomCode: this.code, shared: true }); }
            catch (e) { logger.warn('shared payout failed', e.message); }
          }
        }
      } else {
        const winnerIsHuman = firstWinnerId && allPlayers.find((p) => p.id === firstWinnerId)?.isBot === false;
        if (winnerIsHuman) {
          payoutShares.push({ playerId: firstWinnerId, amount: pot });
          try { await changeCoins(firstWinnerId, pot, 'win', null, { roomCode: this.code }); } catch (e) { logger.warn('payout failed', e.message); }
          // TOR §4.3: a winner of a ≥ 1 000 000 $ stake table gets the Elon
          // Musk sticker pack as a one-off collectible.
          if (stake >= config.game.elonStickerStakeThreshold) {
            try {
              await query(
                `INSERT INTO elon_sticker_grants (user_id, game_id, stake) VALUES ($1, $2, $3)`,
                [firstWinnerId, this.gameState.id, stake]
              );
              await query(
                `UPDATE users SET elon_stickers = elon_stickers + 1 WHERE id = $1`,
                [firstWinnerId]
              );
            } catch (e) { logger.warn('elon sticker grant failed', e.message); }
          }
        } else if (firstWinnerId) {
          logger.info('payout skipped: bot winner', {
            roomCode: this.code,
            winnerId: firstWinnerId,
          });
        }
      }

      // Update per-user stats and stream achievements / drops
      for (const p of allHumans) {
        // Draws don't have a winner; clear isWinner so the win column isn't
        // double-counted alongside isDrawer. winners[] may still contain
        // every player in a draw, which would otherwise inflate games_won.
        const isDrawer = isDraw;
        const isWinner = !isDrawer && (
          winners[0] === p.id ||
          (forfeitedPlayerId && winners.includes(p.id) && p.id !== forfeitedPlayerId)
        );
        const isLoser = !isDrawer && durakId === p.id;
        // TOR §2: bluffs_caught counts toward Sheriff progress — keep the
        // sheriff_marks column in sync so achievements can pin a 5/25 milestone.
        // TOR §9: bluffs_made tracks the monthly "Cunning Fox" / Makkor tulki.
        await query(
          `UPDATE users SET
              games_played = games_played + 1,
              games_won    = games_won    + $2,
              games_lost   = games_lost   + $3,
              games_draw   = games_draw   + $4,
              rank_wins    = rank_wins    + $2,
              win_streak   = CASE WHEN $2 = 1 THEN win_streak + 1 ELSE 0 END,
              loss_streak  = CASE WHEN $3 = 1 THEN loss_streak + 1 ELSE 0 END,
              bluffs_caught  = bluffs_caught  + $5,
              sheriff_marks  = sheriff_marks  + $5,
              bluffs_made    = bluffs_made    + $6,
              games_played_updated_at = now()
            WHERE id = $1
            RETURNING rank_wins, games_played`,
          [p.id, isWinner ? 1 : 0, isLoser ? 1 : 0, isDrawer ? 1 : 0, p.bluffsCaught || 0, p.bluffsMade || 0]
        ).then(async (r) => {
          const gamesPlayed = Number(r.rows[0]?.games_played || 0);
          const { newlyUnlocked } = await recordUnlocksForGamesPlayed(p.id, Math.max(0, gamesPlayed - 1), gamesPlayed);
          if (newlyUnlocked.length) {
            const seat = this.seats.find((s) => s?.id === p.id);
            const socketId = p.socketId || seat?.socketId;
            if (socketId) {
              this.manager.io.to(socketId).emit('features:unlocked', {
                features: newlyUnlocked,
                gamesPlayed,
              });
            }
          }
          // TOR §8: rebuild cached rank columns in the same round-trip using
          // the RETURNING value — avoids a second SELECT per player.
          try {
            const totalWins = Number(r.rows[0]?.rank_wins || 0);
            const rank = computeRankFromWins(totalWins);
            await query(
              `UPDATE users SET rank_color = $1, rank_lines = $2, rank_pluses = $3, rank_progress = $4
                WHERE id = $5`,
              [rank.color, rank.lines, rank.pluses, rank.progress, p.id]
            );
          } catch (e) { logger.warn('rank recompute failed', e.message); }
        }).catch((e) => logger.warn('stats update failed', e.message));
        try { await checkAndUnlock(p.id); } catch (e) { logger.warn('achievement check failed', e.message); }
        try { await maybePayReferralBonus(p.id); } catch (e) { logger.warn('referral pay failed', e.message); }

        // Random emoji drop on game end
        const drop = Math.random();
        const dropChance = isWinner ? 0.5 : 0.2;
        if (drop < dropChance) {
          const e = rollRandomEmoji();
          await query(
            `INSERT INTO inventory (user_id, item_type, item_id, quantity)
             VALUES ($1, 'emoji', $2, 1)
             ON CONFLICT (user_id, item_type, item_id) DO UPDATE SET quantity = inventory.quantity + 1`,
            [p.id, `${e.packId}:${e.emojiId}`]
          );
        }
      }

      // Persist final game record. The 60-second snapshot may have already
      // inserted a row with this id, so use ON CONFLICT — a plain INSERT
      // would raise duplicate_key here and silently lose the result row.
      await query(
        `INSERT INTO games (id, room_code, mode, bluff_enabled, stake, player_ids, bot_slots, winner_id, loser_id, is_draw, final_state, started_at, ended_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, to_timestamp($12 / 1000.0), now())
         ON CONFLICT (id) DO UPDATE SET
           winner_id   = EXCLUDED.winner_id,
           loser_id    = EXCLUDED.loser_id,
           is_draw     = EXCLUDED.is_draw,
           final_state = EXCLUDED.final_state,
           ended_at    = EXCLUDED.ended_at`,
        [
          this.gameState.id,
          this.code,
          this.mode,
          this.bluffEnabled,
          stake,
          this.gameState.players.filter((p) => !p.isBot).map((p) => p.id),
          this.gameState.players.filter((p) => p.isBot).length,
          firstWinnerId && this.gameState.players.find((p) => p.id === firstWinnerId)?.isBot === false ? firstWinnerId : null,
          durakId && this.gameState.players.find((p) => p.id === durakId)?.isBot === false ? durakId : null,
          isDraw,
          this.sanitizeStateForDB(),
          this.gameState.startedAt,
        ]
      );
      await syncManyUserGameStats(allHumans.map((p) => p.id));
      if (!isDraw && this.tournamentMatch?.matchId) {
        await this.resolveTournamentMatch(firstWinnerId, durakId);
      }
      for (const p of allHumans) {
        const stats = this.humanActionStats.get(p.id) || { actions: 0, totalTurnMs: 0, actionTypes: {} };
        const seat = this.seats.find((s) => s?.id === p.id);
        try {
          const playtime = await query(
            `SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (ended_at - started_at))) / 60, 0) AS minutes
               FROM games
              WHERE $1 = ANY(player_ids)
                AND ended_at IS NOT NULL
                AND started_at >= date_trunc('day', now())`,
            [p.id]
          );
          await recordGameMetrics({
            userId: p.id,
            avgTurnMs: stats.actions ? Math.round(stats.totalTurnMs / stats.actions) : this.turnTimeoutMs,
            actionTypes: stats.actionTypes,
            totalPlayMinutes: Number(playtime.rows[0]?.minutes || 0),
            ip: seat?.ip || null,
            deviceId: seat?.deviceId || null,
          });
        } catch (e) { logger.warn('antibot metric failed', e.message); }
      }
      for (const p of allHumans) {
        try { await grantAvailableProfileRewards(p.id); }
        catch (e) { logger.warn('profile reward failed', e.message); }
      }
      const dirtyUserIds = allHumans.map((p) => p.id).filter(Boolean);
      if (dirtyUserIds.length) {
        this.emitUserStatsDirty('game-end', dirtyUserIds);
      }
    } catch (err) {
      logger.error('finishGame persist error:', err);
    }

    this.broadcastGameState('game:end');

    // PRO: log a structured admin event so the live dashboard feed can
    // surface every finished game without trawling the games table.
    try {
      await query(
        `INSERT INTO admin_events (level, category, message, metadata)
         VALUES ('info', 'game_end', $1, $2)`,
        [
          isDraw ? `Draw at table ${this.code}` : `Game ended at table ${this.code}`,
          { code: this.code, stake, winnerId: firstWinnerId, durakId, isDraw, pot: stake * allPlayers.length },
        ]
      );
    } catch (_) { /* non-fatal */ }
    // PRO: remove the room from the shared Redis registry so the admin
    // Room Monitor stops listing it across instances.
    unregisterRoom(this.code).catch(() => {});

    setTimeout(() => this.manager.destroy(this.code), 30_000);
  }

  async resolveTournamentMatch(firstWinnerId, durakId) {
    const entries = this.tournamentMatch?.entries || [];
    let winnerEntryId = entries.find((e) => e.userId && e.userId === firstWinnerId)?.entryId;
    if (!winnerEntryId) {
      const nonLoser = entries.find((e) => !e.userId || e.userId !== durakId);
      winnerEntryId = nonLoser?.entryId;
    }
    if (!winnerEntryId) {
      logger.warn('tournament match result skipped: winner entry not found', {
        roomCode: this.code,
        matchId: this.tournamentMatch.matchId,
        firstWinnerId,
      });
      return;
    }
    const result = await recordMatchResult({
      matchId: this.tournamentMatch.matchId,
      winnerEntryId,
    });
    this.manager.io.to(`tournament:${this.tournamentMatch.tournamentId}`).emit('tournament:match_result', {
      tournamentId: this.tournamentMatch.tournamentId,
      matchId: this.tournamentMatch.matchId,
      winnerEntryId,
      roomCode: this.code,
      result,
    });
  }

  /** Public lobby snapshot. Bot avatar metadata is exposed (color/lines/pluses) so the client can render rank decorations identically for bots and humans. */
  lobbySnapshot() {
    return {
      code: this.code,
      maxPlayers: this.maxPlayers,
      stake: this.stake,
      bluffEnabled: this.bluffEnabled,
      mode: this.mode,
      isPrivate: this.isPrivate,
      hasPassword: !!this.password,
      deckSize: this.deckSize,
      turnSeconds: Math.round(this.turnTimeoutMs / 1000),
      transferEnabled: this.transferEnabled,
      throwInMode: this.throwInMode,
      allowDraw: this.allowDraw,
      seats: this.seats.map((s) => s ? {
        id: s.id,
        username: s.username,
        ready: s.ready,
        avatarColor: s.avatarColor,
        avatarLines: s.avatarLines,
        avatarPluses: s.avatarPluses,
        rankWins: s.rankWins,
      } : null),
      host: this.host ? { id: this.host.id, username: this.host.username } : null,
      phase: this.state.phase,
    };
  }

  broadcastLobby() {
    this.manager.io.to(`room:${this.code}`).emit('room:state', this.lobbySnapshot());
    this.manager.broadcastPublicList();
  }

  viewForPlayer(playerId) {
    if (!this.gameState) return null;
    const view = viewFor(this.gameState, playerId);
    view.turnDeadline = this.turnDeadline;
    view.turnDurationMs = this.turnTimeoutMs;
    view.maxPlayers = this.maxPlayers;
    view.textChatEligible = this.maxPlayers === 2;
    view.voiceEligible = this.maxPlayers === 2
      && this.seats.filter((s) => s && !s.isBot && s.socketId).length === 2;
    return view;
  }

  viewForSpectator() {
    if (!this.gameState) return null;
    const view = viewFor(this.gameState, null);
    view.turnDeadline = this.turnDeadline;
    view.turnDurationMs = this.turnTimeoutMs;
    view.maxPlayers = this.maxPlayers;
    view.textChatEligible = this.maxPlayers === 2;
    view.voiceEligible = this.maxPlayers === 2
      && this.seats.filter((s) => s && !s.isBot && s.socketId).length === 2;
    view.spectator = true;
    view.roomCode = this.code;
    view.tournamentMatch = this.tournamentMatch;
    return view;
  }

  addSpectator(socketId, meta = {}) {
    this.spectators.set(socketId, { ...meta, joinedAt: Date.now() });
    const sock = this.manager.io.sockets.sockets.get(socketId);
    if (sock && this.gameState) sock.emit('spectator:state', this.viewForSpectator());
    return { ok: true, viewers: this.spectators.size, view: this.viewForSpectator() };
  }

  removeSpectator(socketId) {
    this.spectators.delete(socketId);
    return this.spectators.size;
  }

  broadcastGameState(eventName) {
    if (!this.gameState) return;
    for (const seat of this.seats) {
      if (!seat || seat.isBot) continue;
      const sock = this.manager.io.sockets.sockets.get(seat.socketId);
      if (sock) {
        const view = this.viewForPlayer(seat.id);
        sock.emit(eventName, view);
      }
    }
    const spectatorView = this.viewForSpectator();
    for (const socketId of this.spectators.keys()) {
      const sock = this.manager.io.sockets.sockets.get(socketId);
      if (sock) sock.emit('spectator:state', { ...spectatorView, sourceEvent: eventName });
      else this.spectators.delete(socketId);
    }
  }

  cleanup() {
    if (this.turnTimer) clearTimeout(this.turnTimer);
    if (this.botActionTimer) clearTimeout(this.botActionTimer);
    if (this.botFillTimer) clearTimeout(this.botFillTimer);
    if (this.quickStartTimer) clearTimeout(this.quickStartTimer);
    if (this.snapshotTimer) clearInterval(this.snapshotTimer);
    this.spectators.clear();
    // Return any seated bots to the global pool.
    // Bug 7 fix: `startsWith('bot-')` faqat fallback botlarga to'g'ri keladi.
    // DB botlar UUID id bilan keladi — isBot flagi asosida release qilinadi.
    for (const seat of this.seats) {
      if (seat?.isBot && seat.id) {
        releaseBot(seat.id).catch(() => {});
      }
    }
  }
}
