// Friends — qidirish, taklif yuborish, sovg'a, olib tashlash
// MIJOZ KRITIK FIX: "do'st taklif qiladigan joyi ishlamayapti" — to'liq qayta yozildi.
import { h } from '../ui.js';
import { api } from '../api.js';
import { state, toast } from '../state.js';
import { navigate } from '../router.js';
import { avatarColorFor, avatarLetter } from '../cards.js';
import { sfx } from '../sfx.js?v=164-i18n-audio';
import { connectSocket } from '../socket.js';

export async function renderFriends(root, params = {}) {
  root.innerHTML = '';
  const wrap = h('div', { class: 'screen bg-lobby' });
  const focusMessages = params?.tab === 'messages';

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
                friendNameLine(u, false, u.nickname ? `@${u.nickname}` : u.username),
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
  if (focusMessages) {
    scroll.appendChild(renderFriendMessagesCard(root, list));
  }
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
          friendNameLine(f, isPending, `@${f.username}`),
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
          onclick: () => {
            sfx.play('click');
            openFriendMessageModal(root, f);
          }
        }, ['✉']) : null,
        !isPending ? h('button', {
          class: 'btn-secondary', style: 'padding:8px 12px;font-size:14px',
          onclick: () => {
            sfx.play('click');
            openFriendGiftModal(root, f);
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

function renderFriendMessagesCard(root, friends = []) {
  const accepted = friends.filter((f) => f.status !== 'pending');
  const card = h('div', { class: 'section-card friend-messages-card' });
  card.appendChild(h('h3', { style: 'display:flex;align-items:center;justify-content:space-between;gap:10px' }, [
    h('span', {}, ['✉ Xabarlar']),
    h('span', { class: 'badge gold' }, [String(accepted.length)]),
  ]));
  if (!accepted.length) {
    card.appendChild(h('div', { class: 'muted text-c', style: 'padding:20px 12px' }, [
      'Xabar yozish uchun avval do‘st qo‘shing',
    ]));
    return card;
  }
  const list = h('div', { style: 'display:grid;gap:8px' });
  for (const friend of accepted.slice(0, 20)) {
    list.appendChild(h('button', {
      class: 'btn-secondary',
      style: 'display:flex;align-items:center;justify-content:space-between;gap:10px;text-align:left;padding:11px 12px',
      onclick: () => openFriendMessageModal(root, friend),
    }, [
      h('span', { style: 'display:flex;align-items:center;gap:10px;min-width:0' }, [
        h('span', { class: `avatar sm color-${avatarColorFor(friend.id)}` }, [avatarLetter(friend.username)]),
        h('span', { style: 'min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap' }, [`@${friend.nickname || friend.username}`]),
      ]),
      h('b', {}, [friend.online ? 'Online' : 'Yozish']),
    ]));
  }
  card.appendChild(list);
  return card;
}

function messageTime(value) {
  try {
    return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch (_) {
    return '';
  }
}

function openFriendMessageModal(root, friend) {
  const friendName = `@${friend.nickname || friend.username}`;
  const list = h('div', {
    class: 'friend-chat-list',
    style: 'display:grid;gap:8px;max-height:min(52dvh,420px);overflow:auto;padding:8px;border:1px solid rgba(216,179,95,.25);border-radius:12px;background:rgba(0,0,0,.22)',
  }, [h('div', { class: 'muted text-c', style: 'padding:14px' }, ['Xabarlar yuklanmoqda...'])]);
  const input = h('textarea', {
    placeholder: 'Xabar yozing...',
    maxlength: '1000',
    style: 'min-height:74px;width:100%;resize:vertical',
  });
  let socket = null;

  const renderMessages = (messages = []) => {
    list.innerHTML = '';
    if (!messages.length) {
      list.appendChild(h('div', { class: 'muted text-c', style: 'padding:14px' }, ['Hali xabar yo‘q']));
      return;
    }
    for (const msg of messages) appendMessage(msg, false);
    list.scrollTop = list.scrollHeight;
  };

  const appendMessage = (msg, scroll = true) => {
    const mine = !!msg.mine || String(msg.senderId) === String(state.user?.id);
    list.appendChild(h('div', {
      style: `justify-self:${mine ? 'end' : 'start'};max-width:82%;padding:9px 11px;border-radius:12px;border:1px solid rgba(216,179,95,.28);background:${mine ? 'linear-gradient(180deg,#81520f,#3b2209)' : 'rgba(255,255,255,.06)'};color:#fff3c4`,
    }, [
      h('div', { style: 'white-space:pre-wrap;word-break:break-word;font-weight:800' }, [msg.content || '']),
      h('small', { style: 'display:block;margin-top:4px;color:#d8bd80;text-align:right' }, [messageTime(msg.sentAt)]),
    ]));
    if (scroll) list.scrollTop = list.scrollHeight;
  };

  const load = async () => {
    try {
      const messages = await api.friendMessages(friend.id);
      renderMessages(messages);
    } catch (e) {
      list.innerHTML = '';
      list.appendChild(h('div', { class: 'error', style: 'padding:10px' }, [e.message || 'Xabarlar yuklanmadi']));
    }
  };

  const close = () => {
    try { socket?.off?.('friend:message', onIncoming); } catch (_) {}
    bg.remove();
  };

  const onIncoming = (msg) => {
    if (String(msg.friendId || msg.senderId) !== String(friend.id)) return;
    appendMessage({ ...msg, mine: false });
  };

  const send = async () => {
    const text = String(input.value || '').trim();
    if (!text) return toast('Xabar yozing', 'info');
    input.disabled = true;
    try {
      const result = await api.sendFriendMessage(friend.id, text);
      input.value = '';
      appendMessage(result.message || { content: text, mine: true, sentAt: new Date().toISOString() });
      sfx.play('click');
    } catch (e) {
      toast(e.message || 'Xabar yuborilmadi', 'error');
    } finally {
      input.disabled = false;
      input.focus();
    }
  };

  const bg = h('div', { class: 'modal-bg friend-message-modal-bg', onclick: (e) => { if (e.target === bg) close(); } }, [
    h('div', { class: 'modal friend-message-modal' }, [
      h('button', { class: 'chat-close-btn', onclick: close }, ['×']),
      h('h2', {}, ['✉ Xabarlar']),
      h('p', { class: 'muted' }, [`Do‘st: ${friendName}`]),
      list,
      input,
      h('div', { class: 'row mt-16 gap-12' }, [
        h('button', { class: 'btn-secondary grow', onclick: close }, ['Yopish']),
        h('button', { class: 'btn-big green grow', style: 'width:auto;min-height:auto;padding:13px', onclick: send }, ['Yuborish']),
      ]),
    ]),
  ]);
  document.body.appendChild(bg);
  setTimeout(() => input.focus(), 80);
  load();
  try {
    socket = connectSocket();
    socket.on('friend:message', onIncoming);
  } catch (_) {}
}

function countryCode(value) {
  const code = String(value || '').trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : '';
}

function countryFlag(code) {
  const normalized = countryCode(code);
  if (!normalized) return null;
  const srcByCode = {
    UZ: '/flags/uz.jpg',
    RU: '/flags/ru.jfif',
    EN: '/flags/en.avif',
    GB: '/flags/en.avif',
    US: '/flags/en.avif',
  };
  const src = srcByCode[normalized];
  if (src) {
    return h('img', {
      class: 'friend-country-flag',
      src,
      alt: normalized,
      loading: 'lazy',
    });
  }
  return h('span', { class: 'friend-country-code' }, [normalized]);
}

function friendNameLine(user, isPending = false, label = '') {
  return h('div', { class: 'friend-name-line' }, [
    countryFlag(user?.country_code),
    h('span', { class: 'friend-name-text' }, [`${label || user?.username || 'Player'}${isPending ? ' ⏳' : ''}`]),
  ]);
}

function openFriendGiftModal(root, friend) {
  const friendName = `@${friend.nickname || friend.username}`;
  const close = () => bg.remove();
  const status = h('div', { class: 'muted', style: 'font-size:12px;min-height:18px' }, ['Faqat ortiqcha sticker pack va tasodifiy karta yuboriladi']);
  const list = h('div', { style: 'display:grid;gap:8px;margin-top:10px' });

  const run = async (label, task) => {
    try {
      status.textContent = 'Yuborilmoqda...';
      await task();
      sfx.play('coin');
      toast(`✓ ${friendName} ga ${label} yuborildi`, 'success');
      close();
      renderFriends(root);
    } catch (e) {
      status.textContent = e.message || "Sovg'a yuborilmadi";
      toast(e.message || "Sovg'a yuborilmadi", 'error');
    }
  };

  list.appendChild(h('button', {
    class: 'btn-secondary',
    onclick: async () => {
      status.textContent = 'Stikerlar yuklanmoqda...';
      const packs = await api.stickerInventory().catch(() => []);
      const owned = packs.filter((p) => Number(p.giftable || 0) > 0);
      if (!owned.length) {
        status.textContent = 'Sovg‘a qilinadigan ortiqcha sticker pack yo‘q';
        return toast('Ortiqcha sticker pack yo‘q', 'info');
      }
      list.innerHTML = '';
      for (const pack of owned.slice(0, 10)) {
        list.appendChild(h('button', {
          class: 'btn-secondary',
          onclick: () => run(pack.name || 'Sticker', () => api.giftSticker(friend.id, pack.id, `${pack.name || 'Sticker'} sovg‘a`)),
        }, [`🎭 ${pack.name || pack.id} x${pack.giftable}`]));
      }
      list.appendChild(h('button', { class: 'btn-secondary', onclick: close }, ['Yopish']));
      status.textContent = 'Qaysi ortiqcha sticker pack yuboriladi?';
    },
  }, ['Sticker pack']));
  list.appendChild(h('button', {
    class: 'btn-secondary',
    onclick: async () => {
      status.textContent = 'Kartalar yuklanmoqda...';
      const inv = await api.inventoryGrouped().catch(() => null);
      const skins = (inv?.cardSkins || []).filter((skin) => Number(skin.giftable || 0) > 0);
      if (!skins.length) {
        status.textContent = 'Sovg‘a qilinadigan ortiqcha random karta yo‘q';
        return toast('Ortiqcha random karta yo‘q', 'info');
      }
      list.innerHTML = '';
      for (const skin of skins.slice(0, 10)) {
        list.appendChild(h('button', {
          class: 'btn-secondary',
          onclick: () => run(skin.name || 'Karta', () => api.giftSkin(friend.id, skin.id, `${skin.name || 'Karta'} sovg‘a`)),
        }, [`🃏 ${skin.name || skin.id} x${skin.giftable}`]));
      }
      list.appendChild(h('button', { class: 'btn-secondary', onclick: close }, ['Yopish']));
      status.textContent = 'Qaysi ortiqcha random karta yuboriladi?';
    },
  }, ['Ortiqcha karta']));

  const bg = h('div', { class: 'modal-bg friend-gift-modal-bg', onclick: (e) => { if (e.target === bg) close(); } }, [
    h('div', { class: 'modal friend-gift-modal' }, [
      h('button', { class: 'chat-close-btn', onclick: close }, ['×']),
      h('h2', {}, ['🎁 Sovg‘a yuborish']),
      h('p', { class: 'muted' }, [`Qabul qiluvchi: ${friendName}`]),
      status,
      list,
    ]),
  ]);
  document.body.appendChild(bg);
}
