/**
 * validate.js — Zod-powered request validation middleware.
 *
 * Usage (REST):
 *   import { validateBody, validateQuery } from '../middleware/validate.js';
 *   router.post('/endpoint', authRequired, validateBody(MySchema), handler);
 *
 * Usage (Socket.IO):
 *   import { validateSocketPayload, SOCKET_SCHEMAS } from '../middleware/validate.js';
 *   // In your socket event handler:
 *   const parsed = validateSocketPayload('game:action', payload);
 *   if (!parsed.ok) { return callback({ ok: false, error: parsed.error }); }
 *   const { action, payload: { card } } = parsed.data;
 *
 * All schemas strip unknown keys (stripUnknown equivalent = .strip()).
 * String fields are trimmed and length-capped before schema validation.
 */

import { z } from 'zod';

// ── Shared primitives ────────────────────────────────────────────────────────

/** Safe string: trim, max length. */
const safeStr = (max = 255) =>
  z.string().trim().max(max);

const nonNegInt   = z.number().int().nonnegative();

// ── REST body schemas ────────────────────────────────────────────────────────

export const AUTH_SCHEMAS = {
  register: z.object({
    username:   safeStr(32).min(3).regex(/^[a-zA-Z0-9_]+$/, 'username: only letters, digits and _'),
    email:      z.string().email().max(254).transform((s) => s.toLowerCase().trim()),
    password:   safeStr(128).min(6),
    referralCode: safeStr(32).optional(),
    deviceId:   safeStr(128).optional(),
  }),

  login: z.object({
    identifier: safeStr(254),  // username or email
    password:   safeStr(128),
  }),
};

export const SHOP_SCHEMAS = {
  verifyIap: z.object({
    platform:  z.enum(['android', 'ios']),
    productId: safeStr(128).min(1),
    receipt:   safeStr(8192).min(4),
  }),

  buyPremium: z.object({
    tierId:      safeStr(64).min(1),
    payWithGold: z.boolean().optional().default(false),
  }),

  buySkin: z.object({
    skinId: safeStr(64).min(1),
  }),

  buyEmojiPack: z.object({
    packId: safeStr(64).min(1),
  }),

  buyProfileFrame: z.object({
    frameId: safeStr(64).min(1),
  }),
};

export const USER_SCHEMAS = {
  updateProfile: z.object({
    nickname:   safeStr(32).optional(),
    avatarUrl:  safeStr(512).url().optional().or(z.literal('')),
    bio:        safeStr(200).optional(),
  }),

  changePassword: z.object({
    currentPassword: safeStr(128),
    newPassword:     safeStr(128).min(6),
    confirmPassword: safeStr(128),
  }).refine((d) => d.newPassword === d.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  }),
};

export const CHAT_SCHEMA = z.object({
  message: safeStr(500).min(1),
});

// ── Socket.IO payload schemas ────────────────────────────────────────────────

/** Card rank: 6-A (Durak deck). */
const cardRank = z.enum(['2','3','4','5','6','7','8','9','T','10','J','Q','K','A']);
/** Full card ID e.g. "AS", "10H", "6♣". */
const cardId = z.string()
  .min(2).max(4)
  .regex(/^(2|3|4|5|6|7|8|9|T|10|J|Q|K|A)[SHDC♠♥♦♣]$/, 'Invalid card format');

const roomCode = z.string().trim().min(4).max(16).regex(/^[A-Z0-9]+$/i).transform((s) => s.toUpperCase());
const rtcOffer = z.object({
  type: z.literal('offer'),
  sdp:  safeStr(200000).min(1),
}).passthrough();
const rtcAnswer = z.object({
  type: z.literal('answer'),
  sdp:  safeStr(200000).min(1),
}).passthrough();
const rtcIceCandidate = z.object({
  candidate:        safeStr(4096).optional(),
  sdpMid:           safeStr(128).nullable().optional(),
  sdpMLineIndex:    z.number().int().min(0).max(100).nullable().optional(),
  usernameFragment: safeStr(256).optional(),
}).passthrough().nullable();

export const SOCKET_SCHEMAS = {
  /** game:action */
  'game:action': z.object({
    code:    roomCode,
    action:  z.enum(['attack', 'defense', 'transfer', 'take', 'pass', 'end_attack', 'challenge']),
    payload: z.object({
      card: cardId.optional(),
      bluff: z.boolean().optional(),
      claimedRank: cardRank.optional().transform((rank) => rank === '10' ? 'T' : rank),
      tableIdx: nonNegInt.optional(),
    }).strict().optional().default({}),
  }),

  /** room:join */
  'room:join': z.object({
    code: roomCode,
  }),

  /** room:create */
  'room:create': z.object({
    stake:        nonNegInt,
    maxPlayers:   z.number().int().min(2).max(6),
    mode:         z.enum(['classic', 'throw_in', 'transferable']).default('classic'),
    isPrivate:    z.boolean().default(false),
    bluffEnabled: z.boolean().default(false),
  }),

  /** room:leave */
  'room:leave': z.object({
    code: roomCode,
  }),

  /** chat:send */
  'chat:send': z.object({
    code:    roomCode,
    message: safeStr(500).min(1),
  }),

  /** chat:sticker */
  'chat:sticker': z.object({
    code:     roomCode,
    stickerId: safeStr(64).min(1),
  }),

  /** chat:emoji */
  'chat:emoji': z.object({
    code:  roomCode,
    emoji: safeStr(8).min(1),
  }),

  /** game:perk */
  'game:perk': z.object({
    code:   roomCode,
    perkId: z.enum(['peek_opponents', 'peek_next_card', 'best_move_hint']),
  }),

  /** game:timeout_poke */
  'game:timeout_poke': z.object({
    code: roomCode,
  }),

  /** game:forfeit */
  'game:forfeit': z.object({
    code: roomCode,
  }),

  /** matchmaking:join */
  'matchmaking:join': z.object({
    stake:      nonNegInt,
    maxPlayers: z.number().int().min(2).max(6).optional().default(2),
    mode:       z.enum(['classic', 'throw_in', 'transferable']).optional().default('classic'),
  }),

  /** voice:offer / voice:answer */
  'voice:offer': z.object({
    code:  roomCode,
    offer: rtcOffer,
  }),

  'voice:answer': z.object({
    code:   roomCode,
    answer: rtcAnswer,
  }),

  'voice:ice': z.object({
    code:      roomCode,
    candidate: rtcIceCandidate,
  }),

  'voice:accept': z.object({ code: roomCode }),
  'voice:reject': z.object({ code: roomCode }),
  'voice:end':    z.object({ code: roomCode, reason: safeStr(80).optional() }),
  'voice:request': z.object({ code: roomCode }),
};

// ── REST middleware factories ─────────────────────────────────────────────────

/**
 * Express middleware: parse and validate `req.body` against `schema`.
 * On success, replaces `req.body` with the validated (and stripped) value.
 * On failure, responds 400 with structured field-level errors.
 *
 * @param {import('zod').ZodSchema} schema
 */
export function validateBody(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body ?? {});
    if (!result.success) {
      return res.status(400).json({
        error: 'validation_error',
        details: result.error.errors.map((e) => ({
          field:   e.path.join('.'),
          message: e.message,
          code:    e.code,
        })),
      });
    }
    req.body = result.data;
    next();
  };
}

/**
 * Express middleware: validate `req.query` against `schema`.
 *
 * @param {import('zod').ZodSchema} schema
 */
export function validateQuery(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.query ?? {});
    if (!result.success) {
      return res.status(400).json({
        error: 'validation_error',
        details: result.error.errors.map((e) => ({
          field:   e.path.join('.'),
          message: e.message,
        })),
      });
    }
    req.query = result.data;
    next();
  };
}

// ── Socket.IO helper ─────────────────────────────────────────────────────────

/**
 * Validate a Socket.IO event payload against the registered schema.
 *
 * @param {string}  eventName  — key in SOCKET_SCHEMAS
 * @param {unknown} payload    — raw data from socket.on(eventName, payload => …)
 * @returns {{ ok: true, data: T } | { ok: false, error: string }}
 */
export function validateSocketPayload(eventName, payload) {
  const schema = SOCKET_SCHEMAS[eventName];
  if (!schema) {
    // Unknown event — allow through (don't crash on unregistered events)
    return { ok: true, data: payload };
  }
  const result = schema.safeParse(payload ?? {});
  if (!result.success) {
    const first = result.error.errors[0];
    const msg   = first ? `${first.path.join('.') || 'payload'}: ${first.message}` : 'invalid payload';
    return { ok: false, error: msg };
  }
  return { ok: true, data: result.data };
}
