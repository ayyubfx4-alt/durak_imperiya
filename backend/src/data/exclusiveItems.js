// data/exclusiveItems.js
// Pure constants and helpers for exclusive/referral-gated catalog items.
// NO external dependencies — safe to import in unit tests.

// TOR §7: catalog items whose `id` appears here are gated behind a
// 32-generation referral tree.
export const REFERRAL_GENERATIONS_FOR_EXCLUSIVE = 32;

const EXCLUSIVE_EMOJI_PACK_IDS = new Set(['pack_49', 'pack_50']);
const EXCLUSIVE_CARD_SKIN_IDS  = new Set();

export function isExclusiveItem(itemType, itemId) {
  if (itemType === 'emoji_pack' || itemType === 'emoji') return EXCLUSIVE_EMOJI_PACK_IDS.has(itemId);
  if (itemType === 'card_skin') return EXCLUSIVE_CARD_SKIN_IDS.has(itemId);
  return false;
}
