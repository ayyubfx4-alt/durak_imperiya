// routes/voiceChat.js — Feature 30: Ovozli Chat (Voice Chat)
// These REST endpoints complement the Socket.IO events in game/socket.js.
// The socket layer handles real-time signaling; REST gives the client
// the current session state on reconnect.

import { Router } from 'express';
import { authRequired } from '../middleware/auth.js';
import { requireFeature } from '../services/progression.js';
import {
  getActiveVoiceSession,
  canUseVoice,
  getDailyVoiceCount,
} from '../services/voiceChat.js';

export const voiceChatRouter = Router();
voiceChatRouter.use(authRequired);
voiceChatRouter.use(requireFeature('voice_chat'));

/**
 * GET /api/voice/:roomCode
 * Returns whether there is an active voice session in this room
 * and whether the current user is allowed to start one.
 */
voiceChatRouter.get('/:roomCode', async (req, res, next) => {
  try {
    const { roomCode } = req.params;
    const isPremium = req.user.premium_until
      ? new Date(req.user.premium_until) > new Date()
      : false;

    const [session, eligibility, dailyCount] = await Promise.all([
      getActiveVoiceSession(roomCode),
      canUseVoice(req.user.id, isPremium),
      getDailyVoiceCount(req.user.id),
    ]);

    res.json({
      active:      !!session,
      session:     session || null,
      canRequest:  eligibility.allowed,
      reason:      eligibility.reason || null,
      isPremium,
      dailyUsed:   dailyCount,
      dailyLimit:  isPremium ? null : 3,
    });
  } catch (err) { next(err); }
});
