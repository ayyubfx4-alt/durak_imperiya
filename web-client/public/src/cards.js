// Card face rendering helpers — produces nice-looking HTML cards.

import { h } from './ui.js';
import { CARD_SKIN_META } from './cardSkinMeta.js?v=160-curated-card-skins';

export const SUIT_GLYPH = { S: '♠', H: '♥', D: '♦', C: '♣' };
export const SUIT_RED = (s) => s === 'H' || s === 'D';
export const RANK_LABEL = (r) => (r === 'T' ? '10' : r);
export function normalizeCardSkin(skin) {
  const value = String(skin || 'default').replace(/[^a-z0-9_-]/gi, '');
  return value && CARD_SKIN_META[value] ? value : 'default';
}

export function cardSkinClass(skin) {
  return `skin-${normalizeCardSkin(skin).replace(/[^a-z0-9_-]/gi, '-')}`;
}

export function cardSkinStyle(skin) {
  const id = normalizeCardSkin(skin);
  const meta = CARD_SKIN_META[id] || CARD_SKIN_META.default;
  const image = meta.image ? `url("${meta.image}")` : 'none';
  return `--skin-bg:${meta.bg};--skin-accent:${meta.accent};--skin-image:${image};`;
}

function cardSkinAttrs(skin, extraClass = '') {
  const id = normalizeCardSkin(skin);
  return {
    class: `${cardSkinClass(id)} skin-dynamic ${extraClass}`,
    style: cardSkinStyle(id),
    'data-skin': id,
    'data-has-art': CARD_SKIN_META[id]?.image ? '1' : '0',
  };
}

// Royal card "art" — Unicode glyphs for J/Q/K/A; pip layout for 6-10.
const ROYALS = { J: '♞', Q: '♛', K: '♚', A: '★' };

export function renderCard(card, opts = {}) {
  const skinAttrs = cardSkinAttrs(opts.skin, opts.extraClass || '');
  if (!card || card.faceDown) {
    return h('div', {
      ...skinAttrs,
      class: `card face-down ${skinAttrs.class}`,
    });
  }
  const suit = SUIT_GLYPH[card.suit] || '?';
  const rank = RANK_LABEL(card.rank);
  const colorClass = SUIT_RED(card.suit) ? 'suit-red' : 'suit-black';
  const royalGlyph = ROYALS[card.rank];

  let pip;
  if (royalGlyph) pip = royalGlyph;
  else if (card.rank === 'A') pip = '★';
  else pip = suit;

  const el = h('div', {
    ...skinAttrs,
    class: `card ${colorClass} ${skinAttrs.class}`,
  }, [
    h('div', { class: 'corner tl' }, [
      h('div', {}, [rank]),
      h('div', { style: { fontSize: '12px', lineHeight: '1' } }, [suit]),
    ]),
    h('div', { class: 'pip' }, [pip]),
    h('div', { class: 'corner br' }, [
      h('div', {}, [rank]),
      h('div', { style: { fontSize: '12px', lineHeight: '1' } }, [suit]),
    ]),
  ]);
  return el;
}

export function renderCardId(cardId, opts = {}) {
  if (!cardId) return renderCard(null, opts);
  return renderCard({ rank: cardId[0], suit: cardId[1] }, opts);
}

export function avatarColorFor(idOrName) {
  let h = 0;
  const s = String(idOrName || '');
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h) % 6;
}

export function avatarLetter(name) {
  return (name || '?').trim().charAt(0).toUpperCase();
}

export function flagEmoji(countryCode) {
  const code = String(countryCode || '').trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return '';
  const base = 0x1F1E6 - 65;
  return String.fromCodePoint(
    base + code.charCodeAt(0),
    base + code.charCodeAt(1),
  );
}

export function countryName(countryCode, locale = 'uz') {
  const code = String(countryCode || '').trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return '';
  try {
    return new Intl.DisplayNames([locale, 'en'], { type: 'region' }).of(code) || code;
  } catch (_) {
    return code;
  }
}
