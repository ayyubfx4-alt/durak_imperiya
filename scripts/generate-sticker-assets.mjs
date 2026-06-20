import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outRoot = path.join(root, 'web-client', 'public', 'stickers');

const packs = [
  ['pack_vampir', 'VAMPIR', '#b45cff', '🧛', ['😄', '😭', '😮', '😈', '👍', '😍', '😎', '🌹']],
  ['pack_legend_queen', 'QUEEN', '#f7c95a', '👸', ['👑', '🙂', '😮', '😍', '😘', '👏', '💖', '✨']],
  ['pack_samurai', 'SAMURAI', '#ef4444', '🧔', ['😡', '🥳', '👍', '❤️', '⚔️', '😤', '🔥', '💤']],
  ['pack_ninja', 'NINJA', '#8b5cf6', '🥷', ['👀', '😮', '👍', '❤️', '🌙', '💨', '⚡', '😳']],
  ['pack_panda', 'PANDA', '#84cc16', '🐼', ['😂', '😭', '😡', '😎', '❤️', '👍', '🤍', '😴']],
  ['pack_koala', 'KOALA', '#14b8a6', '🐨', ['😂', '😭', '🥳', '😍', '👍', '😳', '💤', '❤️']],
  ['pack_blink_girl', 'BLINK', '#ec4899', '💁‍♀️', ['😁', '😂', '😍', '😘', '🙋‍♀️', '💜', '✨', '👏']],
  ['pack_cool_boy', 'COOL', '#38bdf8', '😎', ['😁', '😂', '😍', '👍', '🤝', '🔥', '💙', '😘']],
  ['pack_pirate', 'PIRATE', '#f59e0b', '🏴‍☠️', ['😈', '😂', '👑', '👍', '💰', '⚓', '🦜', '❤️']],
  ['pack_clown', 'CLOWN', '#a855f7', '🤡', ['😂', '😭', '😱', '👍', '❤️', '🎈', '🎪', '😡']],
  ['pack_dragon', 'DRAGON', '#dc2626', '🐉', ['🐲', '🔥', '😡', '💚', '💜', '⚡', '👑', '😴']],
  ['pack_wolf', 'WOLF', '#64748b', '🐺', ['😂', '😡', '😭', '❤️', '👍', '🌕', '⚡', '😮']],
  ['pack_lion', 'LION', '#d97706', '🦁', ['😡', '😭', '😍', '👑', '👍', '🔥', '💛', '😴']],
  ['pack_skull', 'SKULL', '#94a3b8', '💀', ['😂', '😭', '😍', '😡', '😴', '🖤', '⚡', '❓']],
  ['pack_alien', 'ALIEN', '#65a30d', '👽', ['😂', '😍', '😭', '😎', '👍', '🛸', '💚', '❤️']],
  ['pack_angel', 'ANGEL', '#38bdf8', '😇', ['👼', '😍', '😭', '🙋‍♀️', '✨', '🤍', '👍', '💤']],
  ['pack_pumpkin', 'PUMPKIN', '#f97316', '🎃', ['😂', '😭', '😱', '😍', '😵', '🔥', '🌙', '💤']],
  ['pack_robot', 'ROBOT', '#22d3ee', '🤖', ['😂', '😍', '❤️', '😴', '👍', '⚙️', '💙', '💤']],
  ['pack_ghost', 'GHOST', '#818cf8', '👻', ['😂', '😭', '😍', '❤️', '😴', '💀', '❓', '😮']],
  ['pack_bunny', 'BUNNY', '#f472b6', '🐰', ['😂', '😭', '😍', '❤️', '👍', '💤', '🌸', '🤍']],
  ['pack_cat', 'CAT', '#8b5cf6', '🐱', ['😂', '😭', '😍', '👍', '💤', '💛', '🐾', '❤️']],
  ['pack_emoji_classic', 'CLASSIC', '#fbbf24', '😀', ['😂', '😍', '😮', '🙂', '😉', '😢', '😎', '😭']],
  ['pack_sport', 'SPORT', '#06b6d4', '⚽', ['🏀', '🏈', '🎱', '😭', '😡', '👍', '🏆', '😮']],
  ['pack_money', 'MONEY', '#65a30d', '💰', ['🤑', '💵', '🤫', '😭', '😍', '👍', '💸', '😮']],
];

function esc(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function svg({ color, label, main, mood, index }) {
  const id = `g${index}`;
  const rotate = index % 2 === 0 ? -5 : 5;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
  <defs>
    <radialGradient id="${id}" cx="34%" cy="24%" r="78%">
      <stop offset="0" stop-color="#ffffff" stop-opacity=".42"/>
      <stop offset=".35" stop-color="${color}" stop-opacity=".42"/>
      <stop offset="1" stop-color="#05050c" stop-opacity="0"/>
    </radialGradient>
    <filter id="shadow" x="-40%" y="-40%" width="180%" height="180%">
      <feDropShadow dx="0" dy="13" stdDeviation="10" flood-color="#000000" flood-opacity=".62"/>
      <feDropShadow dx="0" dy="0" stdDeviation="7" flood-color="${color}" flood-opacity=".50"/>
    </filter>
  </defs>
  <rect width="256" height="256" rx="42" fill="transparent"/>
  <ellipse cx="128" cy="132" rx="88" ry="76" fill="url(#${id})"/>
  <ellipse cx="124" cy="207" rx="66" ry="14" fill="#000" opacity=".32"/>
  <circle cx="190" cy="68" r="30" fill="#090914" opacity=".82" stroke="${color}" stroke-opacity=".72" stroke-width="5"/>
  <g filter="url(#shadow)" transform="rotate(${rotate} 128 128)">
    <text x="128" y="136" text-anchor="middle" dominant-baseline="middle"
      font-family="Apple Color Emoji,Segoe UI Emoji,Noto Color Emoji,Arial,sans-serif"
      font-size="138">${esc(main)}</text>
  </g>
  <g filter="url(#shadow)">
    <text x="190" y="70" text-anchor="middle" dominant-baseline="middle"
      font-family="Apple Color Emoji,Segoe UI Emoji,Noto Color Emoji,Arial,sans-serif"
      font-size="28">${esc(mood)}</text>
  </g>
  <path d="M63 52 C91 29 163 28 194 54" fill="none" stroke="#fff" stroke-opacity=".28" stroke-width="8" stroke-linecap="round"/>
  <text x="128" y="236" text-anchor="middle" font-family="Inter,Arial,sans-serif" font-size="13" font-weight="900" fill="#fff1b8" opacity=".55">${esc(label)} ${index}</text>
</svg>`;
}

for (const [id, label, color, main, moods] of packs) {
  const dir = path.join(outRoot, id);
  fs.mkdirSync(dir, { recursive: true });
  moods.forEach((mood, idx) => {
    fs.writeFileSync(path.join(dir, `${idx + 1}.svg`), svg({ color, label, main, mood, index: idx + 1 }), 'utf8');
  });
}

console.log(`generated ${packs.length * 8} sticker assets`);
