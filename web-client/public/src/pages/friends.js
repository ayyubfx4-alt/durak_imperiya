// Friends — qidirish, taklif yuborish, sovg'a, olib tashlash
// MIJOZ KRITIK FIX: "do'st taklif qiladigan joyi ishlamayapti" — to'liq qayta yozildi.
import { h } from '../ui.js';
import { api } from '../api.js';
import { state, toast } from '../state.js';
import { navigate } from '../router.js';
import { avatarColorFor, avatarLetter } from '../cards.js';
import { sfx } from '../sfx.js?v=111-encoding-fix';

export async function renderFriends(root) {
  root.innerHTML = '';
  const wrap = h('div', { class: 'screen bg-lobby' });

  // Topbar
  wrap.appendChild(h('div', { class: 'lobby-topbar' }, [
    h('button', { class: 'btn-icon', onclick: () => { sfx.play('click'); navigate('home'); } }, ['◀']),
    h('div', { class: 'title' }, ["Do'stlar"]),
    h('div', { class: 'coins' }, [`$${(state.user?.coins || 0).toLocaleString()}`]),
  ]));

  const scroll = h('div', { class: 'scroll', style: 'padding:14px' });

  // ═══ INVITE SECTION (mijoz so'ragan: havola ulashish) ═══
  const inviteCard = h('div', { class: 'section-card' });
  inviteCard.appendChild(h('h3', { style: 'display:flex;align-items:center;gap:10px' }, [
    '🔗 Do\'stlarni taklif qilish',
  ]));

  let me = state.user || {};
  try { me = await api.me(); state.user = me; } catch (_) {}

  if (Number(me.games_played || 0) < 5) {
    const left = Math.max(0, 5 - Number(me.games_played || 0));
    scroll.appendChild(h('div', { class: 'section-card' }, [
      h('h3', {}, ["Do'stlar hali yopiq"]),
      h('p', { class: 'muted', style: 'line-height:1.55' }, [
        `Do'stlar bo'limi 5 ta o'yindan keyin ochiladi. Yana ${left} ta o'yin o'ynang, keyin qidirish, taklif yuborish va sovg'a berish ishlaydi.`,
      ]),
      h('button', { class: 'btn-big green', onclick: () => navigate('lobby') }, ["O'ynash"]),
    ]));
    wrap.appendChild(scroll);
    root.appendChild(wrap);
    return;
  }

  const refCode = me.referral_code || '—';
  const refUrl = `${location.origin}/?ref=${refCode}`;

  inviteCard.appendChild(h('div', {
    style: 'color:var(--rc-text-muted);font-size:13px;line-height:1.55;margin-bottom:12px',
  }, [
    'Har bir do\'st kelishi uchun siz $5 olasiz (Gen 1). Pastki avlodlar (2-32) — $1 har biri. To\'liq 32 avlod = LEADER nishoni + eksklyuziv to\'plamlar!',
  ]));

  // Code chip + Share button
  inviteCard.appendChild(h('div', {
    style: 'display:flex;align-items:center;gap:10px;padding:12px;border-radius:11px;background:linear-gradient(180deg,rgba(255,231,164,.08),rgba(0,0,0,.3));border:2px solid rgba(216,179,95,.4);margin-bottom:12px',
  }, [
    h('div', {
      style: 'font-family:Orbitron,monospace;font-weight:900;letter-spacing:.18em;font-size:20px;color:var(--rc-gold-bright);text-shadow:0 2px 1px #000;flex:1;text-align:center',
    }, [refCode]),
    h('button', {
      class: 'btn-secondary',
      style: 'padding:9px 16px;flex-shrink:0',
      onclick: async () => {
        sfx.play('click');
        try {
          await navigator.clipboard.writeText(refCode);
          toast('✓ Kod nusxalandi', 'success');
        } catch (e) {
          toast(refCode, 'info');
        }
      },
    }, ['📋 Kod']),
  ]));

  // Share buttons — MIJOZ KRITIK FIX
  inviteCard.appendChild(h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' }, [
    h('button', {
      class: 'btn-big green',
      style: 'flex:1;min-width:140px;min-height:46px;padding:11px;font-size:14px',
      onclick: async () => {
        sfx.play('click');
        if (refCode === '—') { toast('Referal kod topilmadi', 'error'); return; }
        const text = `Durak Imperia — premium kart o'yini! Mening referal kodim bilan kiring:\n${refUrl}`;
        if (navigator.share) {
          try {
            await navigator.share({ title: 'Durak Imperia', text, url: refUrl });
          } catch (e) {
            if (e.name !== 'AbortError') {
              try {
                await navigator.clipboard.writeText(refUrl);
                toast('✓ Havola nusxalandi', 'success');
              } catch (_) { toast(refUrl, 'info'); }
            }
          }
        } else {
          try {
            await navigator.clipboard.writeText(refUrl);
            toast('✓ Havola nusxalandi! Do\'stlaringizga yuboring.', 'success');
          } catch (e) {
            const ta = document.createElement('textarea');
            ta.value = refUrl; document.body.appendChild(ta);
            ta.select(); document.execCommand('copy'); ta.remove();
            toast('✓ Havola nusxalandi', 'success');
          }
        }
      },
    }, ['📤 Havolani Ulashish']),
    h('button', {
      class: 'btn-secondary',
      style: 'flex:1;min-width:140px;padding:11px;font-size:13px',
      onclick: async () => {
        sfx.play('click');
        const tgUrl = `https://t.me/share/url?url=${encodeURIComponent(refUrl)}&text=${encodeURIComponent('Durak Imperia ga qo\'shiling!')}`;
        window.open(tgUrl, '_blank');
      },
    }, ['✈️  Telegram']),
    h('button', {
      class: 'btn-secondary',
      style: 'flex:1;min-width:140px;padding:11px;font-size:13px',
      onclick: () => {
        sfx.play('click');
        const waUrl = `https://wa.me/?text=${encodeURIComponent('Durak Imperia: ' + refUrl)}`;
        window.open(waUrl, '_blank');
      },
    }, ['💬  WhatsApp']),
  ]));
  scroll.appendChild(inviteCard);

  // ═══ SEARCH SECTION ═══
  const searchCard = h('div', { class: 'section-card' });
  searchCard.appendChild(h('h3', {}, ['🔍 Do\'st topish']));
  const searchInput = h('input', { placeholder: '@nickname yoki ism kiriting...' });
  searchCard.appendChild(searchInput);
  const results = h('div', { style: 'margin-top:12px' });
  searchCard.appendChild(results);

  let searchTimer = null;
  searchInput.addEventListener('input', (e) => {
    const q = e.target.value;
    if (searchTimer) clearTimeout(searchTimer);
    if (q.length < 2) { results.innerHTML = ''; return; }
    searchTimer = setTimeout(async () => {
      try {
        const r = await api.friendsSearch(q);
        results.innerHTML = '';
        if (!r.length) {
          results.appendChild(h('div', { class: 'muted text-c', style: 'padding:14px;font-size:13px' }, ['Topilmadi']));
          return;
        }
        for (const u of r) {
          results.appendChild(h('div', { class: 'list-item' }, [
            h('div', { style: 'display:flex;align-items:center;gap:12px;flex:1;min-width:0' }, [
              h('div', { class: `avatar sm color-${avatarColorFor(u.id)}` }, [avatarLetter(u.username)]),
              h('div', { style: 'min-width:0' }, [
                h('div', { style: 'font-weight:800;color:var(--rc-text-bright)' }, [u.nickname ? `@${u.nickname}` : u.username]),
                h('div', { class: 'muted', style: 'font-size:11px' }, [`${u.rank_wins || 0} g'alaba`]),
              ]),
            ]),
            h('button', {
              class: 'btn-secondary',
              style: 'flex-shrink:0;font-size:12px;padding:8px 14px',
              onclick: async () => {
                sfx.play('click');
                try {
                  await api.friendRequest(u.id);
                  toast('✓ Taklif yuborildi', 'success');
                } catch (e) {
                  toast(e.message || 'Xatolik', 'error');
                }
              },
            }, ['+ Do\'stlik']),
          ]));
        }
      } catch (e) {
        results.innerHTML = '';
        results.appendChild(h('div', { class: 'error', style: 'padding:8px' }, [e.message || 'Xatolik']));
      }
    }, 350);
  });
  scroll.appendChild(searchCard);

  // ═══ FRIENDS LIST ═══
  const list = await api.friends().catch(() => []);
  const friendsCard = h('div', { class: 'section-card' });
  friendsCard.appendChild(h('h3', { style: 'display:flex;align-items:center;justify-content:space-between' }, [
    h('span', {}, [`Do\'stlar`]),
    h('span', { class: 'badge gold' }, [String(list.length)]),
  ]));
  if (!list.length) {
    friendsCard.appendChild(h('div', { class: 'muted text-c', style: 'padding:24px 14px' }, [
      h('div', { style: 'font-size:36px;opacity:.5;margin-bottom:8px' }, ['👥']),
      h('div', {}, ['Hozircha do\'stlaringiz yo\'q']),
    ]));
  }
  for (const f of list) {
    const isPending = f.status === 'pending';
    friendsCard.appendChild(h('div', { class: 'list-item' }, [
      h('div', { style: 'display:flex;align-items:center;gap:12px;flex:1;min-width:0' }, [
        h('div', { class: `avatar sm color-${avatarColorFor(f.id)}` }, [avatarLetter(f.username)]),
        h('div', { style: 'min-width:0' }, [
          h('div', { style: 'font-weight:800;color:var(--rc-text-bright)' }, [
            `@${f.username}${isPending ? ' ⏳' : ''}`,
          ]),
          h('div', { class: 'muted', style: 'font-size:11px' },
            [f.online ? '🟢 Onlayn' : '⚪ Oflayn']),
        ]),
      ]),
      h('div', { style: 'display:flex;gap:6px;flex-shrink:0' }, [
        isPending ? h('button', {
          class: 'btn-secondary', style: 'padding:8px 12px;font-size:12px',
          onclick: async () => {
            sfx.play('click');
            try { await api.friendAccept(f.id); toast('✓ Qabul qilindi', 'success'); renderFriends(root); }
            catch (e) { toast(e.message, 'error'); }
          }
        }, ['✓ Qabul']) : null,
        !isPending ? h('button', {
          class: 'btn-secondary', style: 'padding:8px 12px;font-size:14px',
          onclick: async () => {
            sfx.play('click');
            const amt = Number(prompt('Necha $ sovg\'a yuborasiz?', '100') || 0);
            if (amt > 0) {
              try {
                await api.giftCoins(f.id, amt);
                sfx.play('coin');
                toast(`✓ ${amt}$ sovg'a yuborildi`, 'success');
              } catch (e) { toast(e.message || 'Xatolik', 'error'); }
            }
          }
        }, ['🎁']) : null,
        h('button', {
          class: 'btn-danger', style: 'padding:8px 12px;font-size:14px',
          onclick: async () => {
            sfx.play('click');
            if (confirm(`@${f.username} ni o'chirib tashlash?`)) {
              try { await api.friendRemove(f.id); toast('Olib tashlandi', 'info'); renderFriends(root); }
              catch (e) { toast(e.message, 'error'); }
            }
          }
        }, ['×']),
      ].filter(Boolean)),
    ]));
  }
  scroll.appendChild(friendsCard);

  wrap.appendChild(scroll);
  root.appendChild(wrap);
}
