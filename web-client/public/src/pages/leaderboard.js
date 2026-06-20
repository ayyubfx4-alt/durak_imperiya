import { h } from '../ui.js';
import { api } from '../api.js';
import { navigate } from '../router.js';
import { state } from '../state.js';
import { avatarColorFor, avatarLetter, flagEmoji, countryName } from '../cards.js';

let CATEGORY = 'global';
let REGION = 'global';
let leaderboardLiveCleanups = [];

function clearLeaderboardLiveCleanups() {
  for (const cleanup of leaderboardLiveCleanups.splice(0)) {
    try { cleanup(); } catch (_) {}
  }
}

const CATEGORIES = [
  ['global', '🏆', 'GLOBAL TOP', "Barcha o'yinchilari", 'season'],
  ['weekly', '📅', 'HAFTALIK TOP', "Haftaning eng zo'rlari", 'season'],
  ['monthly', '🗓', 'OYLIK TOP', "Oyning eng zo'rlari", 'won'],
  ['tournament', '🏆', 'TURNIR KUNGLARI', 'Turnirlardagi chempionlar', 'won'],
  ['money', '💲', "ENG KO'P DURAK $", "Eng boy o'yinchilar", 'coins'],
  ['winrate', '🎯', "ENG YUQORI G'ALABA %", "Winrate bo'yicha", 'season'],
  ['streak', '🔥', 'ENG YUQORI SERIYA', "Uzluksiz g'alabalar", 'season'],
  ['countries', '🌍', 'DAVLATLAR TOP', "Qaysi davlat ko'proq yutgan", 'countries'],
  ['pro', '♛', 'PROFESSIONAL TOP', "Pro o'yinchilar", 'season'],
];

const REGIONS = [
  ['global', 'GLOBAL'],
  ['uz', "O'ZBEKISTON"],
  ['mdh', 'MDH'],
  ['eu', 'YEVROPA'],
  ['asia', 'OSIYO'],
  ['us', 'AMERIKA'],
];

const FALLBACK_PLAYERS = [];

function ensureStyles() {
  if (document.getElementById('ranking-v71-styles')) return;
  document.head.appendChild(h('style', { id: 'ranking-v71-styles' }, [`
    .royal-ranking-screen.rr-v71 {
      height: 100dvh;
      overflow: hidden;
      padding: 14px 18px 14px;
      color: #f8e7b2;
      background:
        radial-gradient(circle at 16% 0%, rgba(248, 199, 83, .14), transparent 25%),
        radial-gradient(circle at 88% 10%, rgba(255, 205, 89, .12), transparent 28%),
        radial-gradient(circle at 48% 110%, rgba(107, 72, 22, .18), transparent 34%),
        linear-gradient(145deg, #030606 0%, #071013 48%, #030404 100%);
    }
    .rr-v71::before {
      content: "";
      position: absolute;
      inset: 0;
      pointer-events: none;
      background:
        linear-gradient(90deg, rgba(255,255,255,.025) 1px, transparent 1px),
        linear-gradient(180deg, rgba(255,255,255,.018) 1px, transparent 1px);
      background-size: 48px 48px;
      mask-image: radial-gradient(circle at center, #000, transparent 78%);
      opacity: .5;
    }
    .rr-v71 button { font-family: inherit; cursor: pointer; }
    .rr-v71 .rr-top {
      position: relative;
      z-index: 1;
      min-height: 88px;
      display: grid;
      grid-template-columns: auto minmax(270px, 1fr) auto auto;
      align-items: center;
      gap: 16px;
      margin-bottom: 12px;
    }
    .rr-v71 .rr-back,
    .rr-v71 .rr-wallets button,
    .rr-v71 .rr-actions button,
    .rr-v71 .rr-glass {
      border: 1px solid rgba(226, 174, 75, .38);
      background:
        linear-gradient(180deg, rgba(24,25,21,.92), rgba(4,6,6,.96)),
        radial-gradient(circle at 30% 0%, rgba(255,220,122,.16), transparent 45%);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.06), 0 0 24px rgba(226,174,75,.13), 0 16px 30px rgba(0,0,0,.34);
    }
    .rr-v71 .rr-back {
      width: 58px;
      height: 58px;
      border-radius: 50%;
      color: #ffd66d;
      font-size: 34px;
      font-weight: 900;
      line-height: 1;
      text-shadow: 0 0 14px rgba(255,211,97,.45);
    }
    .rr-v71 .rr-brand {
      display: flex;
      align-items: center;
      gap: 14px;
      min-width: 0;
    }
    .rr-v71 .rr-brand-medal {
      width: 74px;
      height: 74px;
      display: grid;
      place-items: center;
      border: 1px solid rgba(255, 212, 91, .48);
      border-radius: 50%;
      color: #ffe8a3;
      font-size: 47px;
      background:
        radial-gradient(circle at 50% 34%, rgba(255,228,133,.26), transparent 48%),
        linear-gradient(180deg, rgba(67,46,13,.84), rgba(6,7,6,.96));
      box-shadow: 0 0 30px rgba(255,202,70,.24), inset 0 0 18px rgba(255,225,134,.09);
    }
    .rr-v71 .rr-brand h1 {
      margin: 0;
      font-family: Georgia, "Times New Roman", serif;
      color: #ffe49e;
      font-size: clamp(34px, 4.4vw, 54px);
      line-height: .82;
      letter-spacing: .05em;
      text-transform: uppercase;
      text-shadow: 0 2px 0 #2d1603, 0 0 24px rgba(255,214,95,.30);
    }
    .rr-v71 .rr-brand p {
      margin: 8px 0 0;
      color: #e6c87d;
      font-size: 14px;
      font-weight: 900;
      letter-spacing: .04em;
      text-transform: uppercase;
    }
    .rr-v71 .rr-wallets {
      display: flex;
      gap: 12px;
    }
    .rr-v71 .rr-wallets button {
      min-width: 196px;
      height: 56px;
      display: grid;
      grid-template-columns: 34px minmax(0, 1fr) 30px;
      align-items: center;
      gap: 10px;
      padding: 0 10px;
      border-radius: 12px;
      color: #ffebb0;
    }
    .rr-v71 .rr-wallets span,
    .rr-v71 .rr-wallets i {
      width: 31px;
      height: 31px;
      display: grid;
      place-items: center;
      border: 1px solid rgba(255, 218, 117, .44);
      border-radius: 50%;
      background: #070909;
      font-style: normal;
      box-shadow: inset 0 0 10px rgba(255,212,98,.08);
    }
    .rr-v71 .rr-wallets b {
      overflow: hidden;
      color: #ffe9a9;
      font-size: 21px;
      font-weight: 950;
      text-align: center;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .rr-v71 .rr-actions {
      display: flex;
      gap: 12px;
    }
    .rr-v71 .rr-actions button {
      width: 86px;
      height: 66px;
      display: grid;
      place-items: center;
      border-radius: 15px;
      color: #ead096;
      text-transform: uppercase;
    }
    .rr-v71 .rr-actions b {
      color: #ffd66d;
      font-size: 30px;
      line-height: 1;
    }
    .rr-v71 .rr-actions span {
      font-size: 10px;
      font-weight: 950;
      letter-spacing: .03em;
    }
    .rr-v71 .royal-ranking-layout {
      position: relative;
      z-index: 1;
      min-height: 0;
      display: grid;
      grid-template-columns: minmax(246px, 280px) minmax(620px, 1fr) minmax(314px, 370px);
      gap: 14px;
      height: calc(100dvh - 178px);
    }
    .rr-v71 .rr-side {
      min-height: 0;
      display: grid;
      grid-template-rows: minmax(0, 1fr) auto;
      gap: 10px;
    }
    .rr-v71 .rr-category-list {
      min-height: 0;
      overflow: auto;
      border: 1px solid rgba(226,174,75,.30);
      border-radius: 14px;
      background: linear-gradient(180deg, rgba(6,10,11,.90), rgba(2,4,5,.96));
      box-shadow: inset 0 1px 0 rgba(255,255,255,.05), 0 18px 40px rgba(0,0,0,.30);
    }
    .rr-v71 .rr-category-list button {
      width: 100%;
      min-height: 86px;
      display: grid;
      grid-template-columns: 58px minmax(0, 1fr);
      align-items: center;
      gap: 12px;
      padding: 11px 13px;
      border: 0;
      border-bottom: 1px solid rgba(255, 231, 155, .08);
      color: #f1d99e;
      background: transparent;
      text-align: left;
      transition: background .18s ease, box-shadow .18s ease, transform .18s ease;
    }
    .rr-v71 .rr-category-list button.active {
      color: #fff2bd;
      background:
        radial-gradient(circle at 0% 50%, rgba(255,215,87,.34), transparent 48%),
        linear-gradient(90deg, rgba(255,207,72,.23), rgba(255,186,46,.06));
      box-shadow: inset 0 0 0 1px rgba(255,214,95,.52), inset 4px 0 0 #ffd460, 0 0 25px rgba(255,192,45,.22);
    }
    .rr-v71 .rr-category-list button:hover { transform: translateX(2px); background-color: rgba(255,255,255,.025); }
    .rr-v71 .rr-category-list span {
      color: #ffd162;
      font-size: 37px;
      text-align: center;
      filter: drop-shadow(0 0 10px rgba(255,203,74,.24));
    }
    .rr-v71 .rr-category-list strong {
      display: block;
      color: #ffe8a8;
      font-size: 15px;
      font-weight: 950;
      text-transform: uppercase;
    }
    .rr-v71 .rr-category-list small {
      display: block;
      margin-top: 4px;
      color: #d6bd83;
      font-size: 12px;
      font-weight: 800;
    }
    .rr-v71 .rr-my-place {
      padding: 12px 14px;
      border: 1px solid rgba(226,174,75,.34);
      border-radius: 13px;
      background: linear-gradient(180deg, rgba(17,17,14,.82), rgba(4,5,5,.92));
      box-shadow: inset 0 1px 0 rgba(255,255,255,.05), 0 0 20px rgba(255,198,77,.08);
    }
    .rr-v71 .rr-my-place > b {
      display: block;
      color: #ffe29a;
      font-weight: 950;
      text-align: center;
      text-transform: uppercase;
    }
    .rr-v71 .rr-my-place div {
      display: grid;
      grid-template-columns: 38px minmax(0, 1fr) auto;
      align-items: center;
      gap: 9px;
      margin-top: 9px;
    }
    .rr-v71 .rr-my-place span { color: #ffc64b; font-size: 21px; font-weight: 950; }
    .rr-v71 .rr-my-place strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .rr-v71 .rr-my-place em { color: #ffd86e; font-style: normal; white-space: nowrap; }
    .rr-v71 .rr-main {
      min-height: 0;
      display: grid;
      grid-template-rows: auto minmax(0, 1fr);
      gap: 12px;
      overflow: hidden;
    }
    .rr-v71 .rr-region-tabs {
      min-height: 58px;
      display: grid;
      grid-template-columns: repeat(6, minmax(0, 1fr)) 60px;
      overflow: hidden;
      border: 1px solid rgba(226,174,75,.32);
      border-radius: 12px;
      background: linear-gradient(180deg, rgba(8,10,10,.92), rgba(2,4,5,.96));
      box-shadow: 0 14px 26px rgba(0,0,0,.25);
    }
    .rr-v71 .rr-region-tabs button {
      border: 0;
      border-left: 1px solid rgba(255,232,166,.09);
      color: #d7bf87;
      background: transparent;
      font-size: 14px;
      font-weight: 950;
      text-transform: uppercase;
    }
    .rr-v71 .rr-region-tabs button.active {
      color: #fff2bd;
      background: linear-gradient(180deg, #68400d, #140a04);
      box-shadow: inset 0 0 0 1px rgba(255,220,100,.25), 0 0 24px rgba(255,199,61,.14);
    }
    .rr-v71 .rr-filter { color: #ffd66e !important; font-size: 25px !important; }
    .rr-v71 .rr-table-panel {
      min-height: 0;
      overflow: auto;
      border: 1px solid rgba(226,174,75,.20);
      border-radius: 14px;
      background: linear-gradient(180deg, rgba(4,8,10,.82), rgba(2,4,6,.96));
      box-shadow: inset 0 1px 0 rgba(255,255,255,.04), 0 20px 42px rgba(0,0,0,.30);
    }
    .rr-v71 .rr-table-head,
    .rr-v71 .rr-player-row {
      display: grid;
      grid-template-columns: 82px minmax(260px, 1.15fr) minmax(140px, .65fr) minmax(118px, .52fr) minmax(138px, .55fr);
      align-items: center;
      gap: 10px;
    }
    .rr-v71 .rr-table-head {
      position: sticky;
      top: 0;
      z-index: 2;
      height: 54px;
      padding: 0 16px;
      color: #d0ad65;
      background: rgba(3,5,6,.96);
      border-bottom: 1px solid rgba(226,174,75,.24);
      font-size: 13px;
      font-weight: 950;
      text-transform: uppercase;
    }
    .rr-v71 .rr-player-row {
      width: calc(100% - 14px);
      min-height: 82px;
      margin: 7px;
      padding: 10px 13px;
      border: 1px solid rgba(226,174,75,.13);
      border-radius: 12px;
      color: #f9e6ad;
      background: rgba(255,255,255,.014);
      text-align: left;
      transition: transform .16s ease, border-color .16s ease, box-shadow .16s ease;
    }
    .rr-v71 .rr-player-row:hover {
      transform: translateY(-1px);
      border-color: rgba(255,214,95,.35);
      box-shadow: 0 0 18px rgba(255,204,75,.09);
    }
    .rr-v71 .rr-player-row.rank-1 {
      background:
        radial-gradient(circle at 9% 50%, rgba(255,220,82,.25), transparent 30%),
        linear-gradient(90deg, rgba(255,203,54,.22), rgba(255,202,55,.065), rgba(0,0,0,.04));
      border-color: rgba(255,216,91,.48);
      box-shadow: inset 0 0 0 1px rgba(255,212,80,.22), 0 0 24px rgba(255,195,33,.18);
    }
    .rr-v71 .rr-player-row.me { box-shadow: inset 4px 0 0 #63ff88; }
    .rr-v71 .rr-place { display: grid; place-items: center; color: #d5b777; }
    .rr-v71 .rr-place > span { color: #d8bd80; font-size: 25px; font-weight: 950; }
    .rr-v71 .rr-medal {
      width: 60px;
      height: 60px;
      display: grid;
      place-items: center;
      border-radius: 50%;
      background: radial-gradient(circle at 35% 25%, #fff5b8, #d59822 43%, #5a3106 72%);
      box-shadow: 0 0 22px rgba(255,199,53,.34), inset 0 0 0 2px rgba(255,255,255,.14);
    }
    .rr-v71 .rr-medal span { color: #2a1503; font-size: 30px; font-weight: 1000; text-shadow: 0 1px 0 rgba(255,255,255,.50); }
    .rr-v71 .rr-medal-2 { background: radial-gradient(circle at 35% 25%, #ffffff, #c8d0d8 44%, #515964 75%); box-shadow: 0 0 20px rgba(223,232,241,.22); }
    .rr-v71 .rr-medal-3 { background: radial-gradient(circle at 35% 25%, #ffe0b1, #bd7141 44%, #4c2111 75%); box-shadow: 0 0 20px rgba(213,126,58,.22); }
    .rr-v71 .rr-player {
      min-width: 0;
      display: grid;
      grid-template-columns: 62px minmax(0, 1fr);
      align-items: center;
      gap: 13px;
    }
    .rr-v71 .rr-avatar {
      width: 62px;
      height: 62px;
      display: grid;
      place-items: center;
      overflow: hidden;
      border: 2px solid rgba(255,219,108,.62);
      border-radius: 50%;
      color: #ffe9a8;
      background: linear-gradient(145deg, #633914, #0b0b0b);
      box-shadow: 0 10px 18px rgba(0,0,0,.38), 0 0 18px rgba(255,205,83,.11);
      font-size: 26px;
      font-weight: 1000;
    }
    .rr-v71 .rr-avatar img { width: 100%; height: 100%; object-fit: cover; }
    .rr-v71 .rr-player strong {
      display: block;
      min-width: 0;
      overflow: hidden;
      color: #fff5cb;
      font-size: 19px;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .rr-v71 .rr-player small {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-top: 5px;
      color: #d9b874;
      font-size: 12px;
      font-weight: 950;
      text-transform: uppercase;
    }
    .rr-v71 .league-badge {
      padding: 3px 10px;
      border: 1px solid rgba(172, 83, 255, .55);
      border-radius: 999px;
      color: #e9a4ff;
      background: rgba(80, 20, 120, .18);
      box-shadow: inset 0 0 10px rgba(171,91,255,.10);
    }
    .rr-v71 .rr-player i { width: 10px; height: 10px; border-radius: 50%; background: #45dc37; box-shadow: 0 0 9px rgba(69,220,55,.65); }
    .rr-v71 .rr-player i.off { background: #c22e2e; box-shadow: 0 0 9px rgba(194,46,46,.56); }
    .rr-v71 .rr-money b,
    .rr-v71 .rr-winrate b,
    .rr-v71 .rr-streak b {
      display: block;
      color: #ffd46c;
      font-size: 20px;
      font-weight: 950;
    }
    .rr-v71 .rr-money small,
    .rr-v71 .rr-winrate small,
    .rr-v71 .rr-streak small {
      display: block;
      margin-top: 3px;
      color: #d0ad65;
      font-size: 11px;
      font-weight: 900;
      text-transform: uppercase;
    }
    .rr-v71 .rr-streak {
      display: grid;
      grid-template-columns: 34px minmax(0, 1fr);
      align-items: center;
    }
    .rr-v71 .rr-streak span { grid-row: 1 / 3; color: #ffb238; font-size: 30px; filter: drop-shadow(0 0 10px rgba(255,153,44,.24)); }
    .rr-v71 .rr-right { min-height: 0; overflow: auto; }
    .rr-v71 .rr-right-stack { display: grid; gap: 10px; }
    .rr-v71 .rr-panel {
      border: 1px solid rgba(226,174,75,.34);
      border-radius: 14px;
      background: linear-gradient(180deg, rgba(8,10,9,.91), rgba(3,4,4,.97));
      box-shadow: inset 0 1px 0 rgba(255,255,255,.055), 0 16px 32px rgba(0,0,0,.29);
    }
    .rr-v71 .rr-season {
      min-height: 76px;
      display: grid;
      place-items: center;
      text-align: center;
      text-transform: uppercase;
      background:
        linear-gradient(90deg, rgba(255,205,67,.11), transparent 18%, transparent 82%, rgba(255,205,67,.11)),
        linear-gradient(180deg, rgba(12,12,9,.94), rgba(3,4,4,.98));
    }
    .rr-v71 .rr-season b { color: #ffe69f; font-size: 22px; font-weight: 1000; }
    .rr-v71 .rr-season span { color: #d6bd81; font-weight: 1000; }
    .rr-v71 .rr-champion { min-height: 182px; padding: 15px; text-align: center; }
    .rr-v71 .rr-laurel {
      position: relative;
      width: 112px;
      height: 112px;
      display: grid;
      place-items: center;
      margin: 0 auto 9px;
      border-radius: 50%;
      background: radial-gradient(circle, rgba(255,226,132,.27), rgba(255,204,69,.08) 55%, transparent 69%);
      box-shadow: 0 0 26px rgba(255,206,72,.22);
    }
    .rr-v71 .rr-laurel::before {
      content: "♛";
      position: absolute;
      top: -15px;
      left: 50%;
      transform: translateX(-50%);
      color: #ffe38e;
      font-size: 24px;
      text-shadow: 0 0 14px rgba(255,218,98,.52);
    }
    .rr-v71 .rr-champion .rr-avatar { width: 92px; height: 92px; font-size: 38px; }
    .rr-v71 .rr-champion h2 { margin: 0; color: #ffe7a4; font-size: 22px; }
    .rr-v71 .rr-champion strong {
      display: inline-block;
      margin: 7px 0;
      padding: 4px 12px;
      border: 1px solid rgba(169,74,255,.55);
      border-radius: 999px;
      color: #e48bff;
      background: rgba(86,31,125,.20);
    }
    .rr-v71 .rr-champion span,
    .rr-v71 .rr-champion small {
      display: block;
      margin-top: 5px;
      color: #d8bd80;
    }
    .rr-v71 .rr-stats,
    .rr-v71 .rr-prizes,
    .rr-v71 .rr-me-mini { padding: 14px; }
    .rr-v71 .rr-stats h3,
    .rr-v71 .rr-prizes h3 {
      margin: 0 0 11px;
      color: #ffe59f;
      text-align: center;
      text-transform: uppercase;
    }
    .rr-v71 .rr-stat-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 0 14px;
    }
    .rr-v71 .rr-stat { padding: 9px 0; border-bottom: 1px solid rgba(255,232,166,.08); }
    .rr-v71 .rr-stat span { display: block; color: #d0ad65; font-size: 11px; font-weight: 900; text-transform: uppercase; }
    .rr-v71 .rr-stat b { display: block; margin-top: 5px; color: #ffe5a2; font-size: 20px; }
    .rr-v71 .rr-prize-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
    .rr-v71 .rr-prize-grid div {
      min-width: 0;
      padding: 9px 5px;
      border: 1px solid rgba(226,174,75,.2);
      border-radius: 10px;
      background: rgba(255,255,255,.023);
      text-align: center;
    }
    .rr-v71 .rr-prize-grid b { color: #ffe59f; font-size: 12px; text-transform: uppercase; }
    .rr-v71 .rr-prize-grid span { display: block; margin: 5px 0; font-size: 38px; filter: drop-shadow(0 0 12px rgba(255,201,72,.20)); }
    .rr-v71 .rr-prize-grid strong { display: block; color: #ffd46c; font-size: 13px; }
    .rr-v71 .rr-prize-grid small { display: block; margin-top: 5px; color: #d8bd80; font-size: 10px; text-transform: uppercase; }
    .rr-v71 .rr-prizes button,
    .rr-v71 .rr-bottom button {
      width: 100%;
      min-height: 44px;
      margin-top: 13px;
      border: 1px solid rgba(255,223,124,.55);
      border-radius: 10px;
      color: #2b1504;
      background:
        linear-gradient(180deg, rgba(255,255,255,.20), transparent 42%),
        linear-gradient(90deg, #7b4608, #d0931d, #ffe38c, #b87612);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.35), 0 0 18px rgba(255,203,71,.22);
      font-weight: 1000;
      text-transform: uppercase;
    }
    .rr-v71 .rr-bottom {
      position: relative;
      z-index: 1;
      min-height: 58px;
      display: grid;
      grid-template-columns: 1.25fr 2.3fr 1.65fr;
      align-items: center;
      gap: 12px;
      margin-top: 12px;
    }
    .rr-v71 .rr-bottom div,
    .rr-v71 .rr-bottom button {
      height: 50px;
      display: grid;
      place-items: center;
      margin: 0;
      padding: 0 12px;
      border: 1px solid rgba(226,174,75,.28);
      border-radius: 12px;
      color: #f1d99e;
      background: linear-gradient(180deg, rgba(10,11,10,.92), rgba(3,4,4,.96));
      font-weight: 950;
      text-align: center;
      text-transform: uppercase;
    }
    .rr-v71 .rr-bottom button {
      color: #ffe19a;
      background: linear-gradient(180deg, #5d390d, #0b0704);
    }
    .rr-v71 .rr-loading,
    .rr-v71 .rr-error,
    .rr-v71 .rr-empty {
      min-height: 190px;
      display: grid;
      gap: 12px;
      place-items: center;
      color: #d8bd80;
      text-align: center;
    }
    .rr-v71 .rr-error button {
      min-height: 42px;
      padding: 0 18px;
      border: 1px solid rgba(255,223,124,.45);
      border-radius: 10px;
      color: #ffe19a;
      background: #1f1408;
      font-weight: 900;
    }
    @media (max-width: 1180px) {
      .royal-ranking-screen.rr-v71 {
        height: auto;
        min-height: 100dvh;
        overflow: auto;
        padding: 8px 8px calc(80px + env(safe-area-inset-bottom));
      }
      .rr-v71 .rr-top {
        position: sticky;
        top: 0;
        z-index: 12;
        grid-template-columns: 44px minmax(0, 1fr);
        gap: 8px;
        min-height: 0;
        padding: 7px;
        border: 1px solid rgba(226,174,75,.32);
        border-radius: 16px;
        background: rgba(4,5,5,.94);
        backdrop-filter: blur(12px);
      }
      .rr-v71 .rr-back { width: 44px; height: 44px; font-size: 26px; }
      .rr-v71 .rr-brand-medal { display: none; }
      .rr-v71 .rr-brand h1 { font-size: 28px; }
      .rr-v71 .rr-brand p { margin-top: 3px; font-size: 10px; }
      .rr-v71 .rr-wallets {
        grid-column: 1 / 3;
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 7px;
      }
      .rr-v71 .rr-wallets button { min-width: 0; height: 43px; grid-template-columns: 28px minmax(0,1fr) 26px; }
      .rr-v71 .rr-wallets b { font-size: 15px; }
      .rr-v71 .rr-wallets span, .rr-v71 .rr-wallets i { width: 26px; height: 26px; }
      .rr-v71 .rr-actions {
        grid-column: 1 / 3;
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 7px;
      }
      .rr-v71 .rr-actions button { width: auto; height: 43px; grid-template-columns: 24px 1fr; text-align: left; }
      .rr-v71 .rr-actions b { font-size: 20px; }
      .rr-v71 .rr-actions span { font-size: 10px; }
      .rr-v71 .royal-ranking-layout { display: block; height: auto; }
      .rr-v71 .rr-side { display: block; }
      .rr-v71 .rr-category-list {
        display: flex;
        gap: 8px;
        overflow: auto;
        border: 0;
        background: transparent;
        padding: 8px 0;
        scrollbar-width: none;
      }
      .rr-v71 .rr-category-list::-webkit-scrollbar { display: none; }
      .rr-v71 .rr-category-list button {
        min-width: 184px;
        min-height: 68px;
        border: 1px solid rgba(226,174,75,.28);
        border-radius: 11px;
        grid-template-columns: 34px minmax(0, 1fr);
        background: rgba(0,0,0,.30);
      }
      .rr-v71 .rr-category-list span { font-size: 25px; }
      .rr-v71 .rr-category-list strong { font-size: 12px; }
      .rr-v71 .rr-category-list small { font-size: 10px; }
      .rr-v71 .rr-my-place { margin-bottom: 8px; }
      .rr-v71 .rr-main { display: block; overflow: visible; }
      .rr-v71 .rr-region-tabs { display: flex; overflow: auto; min-height: 48px; margin-bottom: 8px; }
      .rr-v71 .rr-region-tabs button { min-width: 112px; font-size: 12px; }
      .rr-v71 .rr-region-tabs .rr-filter { min-width: 48px; }
      .rr-v71 .rr-table-panel { overflow: visible; background: transparent; border: 0; box-shadow: none; }
      .rr-v71 .rr-table-head { display: none; }
      .rr-v71 .rr-player-row {
        width: 100%;
        min-height: 78px;
        grid-template-columns: 42px minmax(0, 1fr) 76px;
        gap: 8px;
        margin: 0 0 8px;
        border: 1px solid rgba(226,174,75,.22);
      }
      .rr-v71 .rr-medal { width: 36px; height: 36px; }
      .rr-v71 .rr-medal span { font-size: 20px; }
      .rr-v71 .rr-place > span { font-size: 20px; }
      .rr-v71 .rr-player { grid-template-columns: 50px minmax(0, 1fr); gap: 8px; }
      .rr-v71 .rr-avatar { width: 48px; height: 48px; }
      .rr-v71 .rr-player strong { font-size: 15px; }
      .rr-v71 .rr-player small { font-size: 10px; }
      .rr-v71 .rr-money b { font-size: 14px; }
      .rr-v71 .rr-money small { font-size: 9px; }
      .rr-v71 .rr-winrate, .rr-v71 .rr-streak { display: none; }
      .rr-v71 .rr-right { overflow: visible; margin-top: 10px; }
      .rr-v71 .rr-stat-grid { grid-template-columns: 1fr 1fr; }
      .rr-v71 .rr-bottom {
        position: fixed;
        left: 8px;
        right: 8px;
        bottom: calc(8px + env(safe-area-inset-bottom));
        z-index: 20;
        min-height: 58px;
        grid-template-columns: repeat(3, 1fr);
        gap: 0;
        margin: 0;
        border: 1px solid rgba(226,174,75,.34);
        border-radius: 15px;
        overflow: hidden;
        background: #040505;
      }
      .rr-v71 .rr-bottom div, .rr-v71 .rr-bottom button {
        height: 58px;
        padding: 4px;
        border: 0;
        border-radius: 0;
        background: transparent;
        font-size: 10px;
      }
    }
  `]));
}

export async function renderLeaderboard(root) {
  ensureStyles();
  clearLeaderboardLiveCleanups();
  const cleanups = leaderboardLiveCleanups;
  root.innerHTML = '';
  const wrap = h('div', { class: 'screen royal-ranking-screen rr-v71' });
  root.appendChild(wrap);

  wrap.appendChild(renderTop());
  const layout = h('div', { class: 'royal-ranking-layout' }, [
    renderSide(null),
    h('main', { class: 'rr-main' }, [
      renderRegionTabs(),
      h('section', { class: 'rr-table-panel rr-loading-panel' }, [
        h('div', { class: 'rr-loading' }, ['Reyting yuklanmoqda...']),
      ]),
    ]),
    h('aside', { class: 'rr-right' }, [
      h('div', { class: 'rr-right-stack' }, [
        h('section', { class: 'rr-panel rr-loading' }, ['Statistika yuklanmoqda...']),
      ]),
    ]),
  ]);
  wrap.appendChild(layout);
  wrap.appendChild(renderBottom());

  const main = layout.querySelector('.rr-main');
  const right = layout.querySelector('.rr-right');

  try { state.user = state.user || await api.me(); } catch (_) {}

  try {
    const category = CATEGORIES.find((c) => c[0] === CATEGORY) || CATEGORIES[0];
    const sort = category[4];
    const countryMode = category[0] === 'countries';
    const [rows, overview, myRank] = await Promise.all([
      countryMode ? api.countryLeaderboard() : api.leaderboard(sort, 100),
      api.leaderboardOverview().catch(() => null),
      countryMode ? Promise.resolve(null) : api.leaderboardMe(sort).catch(() => null),
    ]);
    const ranked = countryMode ? normalizeCountryRows(rows || []).slice(0, 50) : rankRows(normalizeRows(rows || []), category[0]).slice(0, 50);
    layout.querySelector('.rr-side').replaceWith(renderSide(myRank));
    main.innerHTML = '';
    main.appendChild(renderRegionTabs());
    main.appendChild(renderTable(ranked, category));
    right.innerHTML = '';
    right.appendChild(renderRightPanel(ranked, overview, myRank, cleanups));
  } catch (e) {
    const ranked = rankRows(FALLBACK_PLAYERS, CATEGORY).slice(0, 8);
    layout.querySelector('.rr-side').replaceWith(renderSide(null));
    main.innerHTML = '';
    main.appendChild(renderRegionTabs());
    main.appendChild(renderTable(ranked, CATEGORIES[0]));
    right.innerHTML = '';
    right.appendChild(renderRightPanel(ranked, null, null, cleanups));
  }
  return clearLeaderboardLiveCleanups;
}

function renderTop() {
  const me = state.user || {};
  return h('header', { class: 'rr-top' }, [
    h('button', { class: 'rr-back', onclick: () => navigate('home'), title: 'Orqaga' }, ['←']),
    h('div', { class: 'rr-brand' }, [
      h('span', { class: 'rr-brand-medal' }, ['♛']),
      h('div', {}, [
        h('h1', {}, ['RANKING']),
        h('p', {}, ["ENG ZO'R O'YINCHILAR REYTINGI"]),
      ]),
    ]),
    h('div', { class: 'rr-wallets' }, [
      wallet('GC', fmt(me.gold_coins || 0), () => navigate('shop', { tab: 'gold' })),
      wallet('💵', fmt(me.coins || 0), () => navigate('shop', { tab: 'dollars' })),
    ]),
    h('nav', { class: 'rr-actions' }, [
      topAction('🎁', 'MUKOFOTLAR', () => navigate('achievements')),
      topAction('?', "QO'LLANMA", () => navigate('rules')),
      topAction('☰', 'MENU', () => navigate('home')),
    ]),
  ]);
}

function wallet(icon, value, onclick) {
  return h('button', { onclick }, [
    h('span', {}, [icon]),
    h('b', {}, [value]),
    h('i', {}, ['+']),
  ]);
}

function topAction(icon, label, onclick) {
  return h('button', { onclick }, [
    h('b', {}, [icon]),
    h('span', {}, [label]),
  ]);
}

function renderSide(myRank) {
  return h('aside', { class: 'rr-side' }, [
    h('div', { class: 'rr-category-list' }, CATEGORIES.map(([id, icon, title, sub]) => h('button', {
      class: CATEGORY === id ? 'active' : '',
      onclick: () => {
        CATEGORY = id;
        renderLeaderboard(document.getElementById('app'));
      },
    }, [
      h('span', {}, [icon]),
      h('div', {}, [h('strong', {}, [title]), h('small', {}, [sub])]),
    ]))),
    renderMyPlace(myRank),
  ]);
}

function renderMyPlace(myRank) {
  const user = myRank?.user || state.user || {};
  return h('div', { class: 'rr-my-place' }, [
    h('b', {}, ["MENING O'RNIM"]),
    h('div', {}, [
      h('span', {}, [myRank?.rank ? String(myRank.rank) : '-']),
      h('strong', {}, [cleanName(user)]),
      h('em', {}, [`${fmt(user.coins || 0)} GC`]),
    ]),
  ]);
}

function renderRegionTabs() {
  return h('div', { class: 'rr-region-tabs' }, [
    ...REGIONS.map(([id, label]) => h('button', {
      class: REGION === id ? 'active' : '',
      onclick: () => {
        REGION = id;
        renderLeaderboard(document.getElementById('app'));
      },
    }, [label])),
    h('button', { class: 'rr-filter', title: 'Filter' }, ['▾']),
  ]);
}

function renderTable(rows, category) {
  if (category?.[0] === 'countries') return renderCountryTable(rows);
  return h('section', { class: 'rr-table-panel' }, [
    h('div', { class: 'rr-table-head' }, [
      h('span', {}, ["O'RIN"]),
      h('span', {}, ["O'YINCHI"]),
      h('span', {}, ['DURAK $']),
      h('span', {}, ["G'ALABA %"]),
      h('span', {}, ["G'ALABA SERIYASI"]),
    ]),
    h('div', { class: 'rr-table-body' }, rows.length
      ? rows.map((u, i) => renderRow(u, i, category))
      : [h('div', { class: 'rr-empty' }, ["Hozircha reytingda o'yinchi yo'q"])]),
  ]);
}

function renderRow(u, index, category) {
  const rank = index + 1;
  const winRate = calcWinRate(u);
  const streak = Number(u.win_streak || Math.max(0, Math.floor(Number(u.games_won || 0) / 3)));
  const online = u.online ?? rank % 3 !== 0;
  return h('button', {
    class: `rr-player-row rank-${rank <= 3 ? rank : 'normal'} ${u.id === state.user?.id ? 'me' : ''}`,
    onclick: () => navigate('profile', { id: u.id }),
  }, [
    h('div', { class: 'rr-place' }, [rank <= 3 ? medalRank(rank) : h('span', {}, [String(rank)])]),
    h('div', { class: 'rr-player' }, [
      renderAvatar(u),
      h('div', {}, [
        h('strong', {}, [displayName(u)]),
        h('small', {}, [
          h('span', { class: 'league-badge' }, [rankTitle(u, category)]),
          h('i', { class: online ? 'on' : 'off' }, []),
        ]),
      ]),
    ]),
    h('div', { class: 'rr-money' }, [h('b', {}, [fmt(u.coins || 0)]), h('small', {}, ['DURAK $'])]),
    h('div', { class: 'rr-winrate' }, [h('b', {}, [`${winRate}%`]), h('small', {}, ["G'ALABA %"])]),
    h('div', { class: 'rr-streak' }, [h('span', {}, ['🔥']), h('b', {}, [String(streak)]), h('small', {}, ['SERIYA'])]),
  ]);
}

function medalRank(rank) {
  return h('b', { class: `rr-medal rr-medal-${rank}` }, [
    h('span', {}, [rank === 1 ? '♛' : String(rank)]),
  ]);
}

function renderAvatar(u) {
  if (u.avatar_url) {
    return h('span', { class: 'rr-avatar' }, [h('img', { src: u.avatar_url, alt: displayName(u) })]);
  }
  return h('span', { class: `rr-avatar color-${avatarColorFor(u.id || u.username)}` }, [avatarLetter(cleanName(u))]);
}

function renderRightPanel(rows, overview, myRank, cleanups = []) {
  const leader = overview?.leader || rows[0] || null;
  const season = overview?.season || { name: 'SEZON', endsInSeconds: 0 };
  return h('div', { class: 'rr-right-stack' }, [
    h('section', { class: 'rr-panel rr-season' }, [
      h('b', {}, [String(season.name || 'SEZON 7').toUpperCase()]),
      h('span', {}, ['TUGASHIGA: ', liveDurationFromSeconds(season.endsInSeconds || 0, cleanups)]),
    ]),
    h('section', { class: 'rr-panel rr-champion' }, leader ? [
      h('div', { class: 'rr-laurel' }, [renderAvatar(leader)]),
      h('h2', {}, [cleanName(leader)]),
      h('strong', {}, [rankTitle(leader)]),
      h('span', {}, [`${flagEmoji(leader.country_code) || '🌍'} ${countryName(leader.country_code) || 'Davlat tanlanmagan'}`]),
      h('small', {}, [`ID: ${String(leader.id || '-').slice(0, 10)}`]),
    ] : [h('p', {}, ["Hali lider yo'q"])]),
    h('section', { class: 'rr-panel rr-stats' }, [
      h('h3', {}, ['STATISTIKA']),
      h('div', { class: 'rr-stat-grid' }, [
        stat("O'YINLAR SONI", fmt(leader?.games_played || 0)),
        stat("G'ALABA %", `${calcWinRate(leader || {})}%`),
        stat('ENG YUQORI SERIYA', leader?.win_streak || 0),
        stat('JAMI YUTGAN', `GC ${fmt(leader?.coins || 0)}`),
      ]),
    ]),
    h('section', { class: 'rr-panel rr-prizes' }, [
      h('h3', {}, ['SEZON MUKOFOTLARI']),
      h('div', { class: 'rr-prize-grid' }, [1, 2, 3].map((n) => prize(n, overview))),
      h('button', { onclick: () => navigate('achievements') }, ['BARCHA MUKOFOTLAR']),
    ]),
    h('section', { class: 'rr-panel rr-me-mini' }, [
      h('span', {}, ['SIZNING NATIJANGIZ']),
      h('b', {}, [`#${myRank?.rank || '-'} • ${fmt(myRank?.user?.coins || state.user?.coins || 0)} $`]),
    ]),
  ]);
}

function prize(n, overview) {
  const fallback = 0;
  const item = overview?.prizes?.find?.((p) => Number(p.placement) === n) || overview?.prizes?.[n - 1];
  const chest = n === 1 ? '🎁' : n === 2 ? '🎁' : '🎁';
  return h('div', {}, [
    h('b', {}, [`${n}-O'RIN`]),
    h('span', {}, [chest]),
    h('strong', {}, [`GC ${fmt(item?.gold_coins || fallback)}`]),
    h('small', {}, [n === 1 ? 'LEGEND RAMKA' : n === 2 ? 'MASTER RAMKA' : 'DIAMOND RAMKA']),
  ]);
}

function renderBottom() {
  return h('footer', { class: 'rr-bottom' }, [
    h('div', {}, ['♛ REYTING HAR 10 DAQIQADA YANGILANADI']),
    h('div', {}, ["♛ O'Z O'RNINGIZNI KO'TARING VA NODIR MUKOFOTLARNI YUTIB OLING!"]),
    h('button', { onclick: () => navigate('profile') }, ["TOP O'YINCHILAR PROFILLARINI KO'RISH"]),
  ]);
}

function stat(label, value) {
  return h('div', { class: 'rr-stat' }, [h('span', {}, [label]), h('b', {}, [String(value)])]);
}

function normalizeRows(rows) {
  return rows;
}

function normalizeCountryRows(rows) {
  return [...rows].sort((a, b) =>
    Number(b.total_wins || 0) - Number(a.total_wins || 0) ||
    Number(b.total_players || 0) - Number(a.total_players || 0)
  );
}

function renderCountryTable(rows) {
  return h('section', { class: 'rr-table-panel' }, [
    h('div', { class: 'rr-table-head' }, [
      h('span', {}, ["O'RIN"]),
      h('span', {}, ['DAVLAT']),
      h('span', {}, ["O'YINCHI"]),
      h('span', {}, ["G'ALABA"]),
      h('span', {}, ["G'ALABA %"]),
    ]),
    h('div', { class: 'rr-table-body' }, rows.length
      ? rows.map((row, index) => {
        const code = row.country_code === 'ZZ' ? '' : row.country_code;
        return h('button', { class: `rr-player-row rank-${index < 3 ? index + 1 : 'normal'}` }, [
          h('div', { class: 'rr-place' }, [index < 3 ? medalRank(index + 1) : h('span', {}, [String(index + 1)])]),
          h('div', { class: 'rr-player' }, [
            h('span', { class: 'rr-avatar rr-country-avatar' }, [flagEmoji(code) || '🌍']),
            h('div', {}, [
              h('strong', {}, [countryName(code) || 'Davlat tanlanmagan']),
              h('small', {}, [`${code || '--'} global reyting`]),
            ]),
          ]),
          h('div', { class: 'rr-money' }, [h('b', {}, [fmt(row.total_players || 0)]), h('small', {}, ["O'YINCHI"])]),
          h('div', { class: 'rr-winrate' }, [h('b', {}, [fmt(row.total_wins || 0)]), h('small', {}, ["G'ALABA"])]),
          h('div', { class: 'rr-streak' }, [h('span', {}, ['%']), h('b', {}, [String(row.win_rate || '0')]), h('small', {}, ['WINRATE'])]),
        ]);
      })
      : [h('div', { class: 'rr-empty' }, ['Davlat statistikasi hali yo‘q'])]),
  ]);
}

function rankRows(rows, category) {
  const list = [...rows];
  if (category === 'winrate') list.sort((a, b) => Number(calcWinRate(b)) - Number(calcWinRate(a)));
  else if (category === 'streak') list.sort((a, b) => Number(b.win_streak || 0) - Number(a.win_streak || 0));
  else if (category === 'money') list.sort((a, b) => Number(b.coins || 0) - Number(a.coins || 0));
  else list.sort((a, b) => Number(b.rank_wins || b.games_won || 0) - Number(a.rank_wins || a.games_won || 0));
  return list;
}

function rankTitle(u) {
  if (u?.league) return u.league;
  const wins = Number(u?.rank_wins || u?.games_won || 0);
  if (wins >= 1200) return 'LEGEND';
  if (wins >= 700) return 'MASTER';
  if (wins >= 400) return 'DIAMOND';
  if (wins >= 150) return 'PLATINUM';
  return 'OLTIN LIGA';
}

function cleanName(u) {
  return String(u?.nickname || u?.username || 'Player').replace(/^@/, '');
}

function displayName(u) {
  const flag = flagEmoji(u?.country_code);
  return `${flag ? `${flag} ` : ''}@${cleanName(u)}`;
}

function calcWinRate(u) {
  if (u?.winRate !== undefined) return Number(u.winRate).toFixed(1);
  const played = Number(u?.games_played || 0);
  const won = Number(u?.games_won || 0);
  if (!played) return '0.0';
  return Math.min(100, Math.max(0, (won / played) * 100)).toFixed(1);
}

function formatDuration(seconds) {
  const s = Math.max(0, Number(seconds || 0));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  return `${d} KUN ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

function liveDurationFromSeconds(seconds, cleanups = []) {
  const startedAt = Date.now();
  const initial = Math.max(0, Number(seconds || 0));
  const node = h('b', { class: 'rr-live-countdown', 'aria-live': 'polite' }, ['']);
  const update = () => {
    node.textContent = formatDuration(Math.max(0, initial - Math.floor((Date.now() - startedAt) / 1000)));
  };
  update();
  if (initial > 0) {
    const interval = setInterval(update, 1000);
    cleanups.push(() => clearInterval(interval));
  }
  return node;
}

function fmt(n) {
  return Number(n || 0).toLocaleString('ru-RU');
}
