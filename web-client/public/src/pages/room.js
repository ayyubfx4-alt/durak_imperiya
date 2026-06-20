// Waiting room (xona) — PREMIUM royal stilida.
// MIJOZ KRITIK FIX:
//   1. Yopiq stol bo'lsa, ROOM CODE xonada katta va ko'rinarli ko'rinadi
//   2. "Kodni ulashish" (Share / Copy) tugmasi
//   3. Real-time o'yinchilar holati (premium UI)
//   4. Raqib topish darhol va ishonchli ishlaydi
import { h, topbar } from '../ui.js';
import { api } from '../api.js';
import { connectSocket, emitWithAck } from '../socket.js';
import { state, toast } from '../state.js';
import { navigate } from '../router.js';
import { avatarColorFor, avatarLetter } from '../cards.js';
import { t } from '../i18n.js';
import { sfx } from '../sfx.js?v=164-i18n-audio';

export async function renderRoom(root, params) {
  const code = params.code;
  if (!code) { navigate('lobby'); return; }

  root.innerHTML = '';
  const wrap = h('div', { class: 'screen bg-lobby room-screen' });
  root.appendChild(wrap);

  // Topbar
  wrap.appendChild(h('div', { class: 'lobby-topbar' }, [
    h('button', { class: 'btn-icon', onclick: () => leave() }, ['◀']),
    h('div', { class: 'title' }, [t('room.title') || 'Xona']),
    h('div', { class: 'coins' }, [`$${(state.user?.coins || 0).toLocaleString()}`]),
  ]));

  const body = h('div', { class: 'scroll room-scroll' });
  wrap.appendChild(body);
  const scrollTrack = h('div', { class: 'room-scroll-track', 'aria-hidden': 'true' }, [
    h('div', { class: 'room-scroll-thumb' }),
  ]);
  wrap.appendChild(scrollTrack);
  const actionBar = h('div', { class: 'room-action-bar' });
  wrap.appendChild(actionBar);

  const socket = connectSocket();

  if (params.action === 'join' || code) {
    let invitePassword = '';
    try {
      if (sessionStorage.getItem('pending_room') === code) {
        invitePassword = sessionStorage.getItem('pending_room_password') || '';
        sessionStorage.removeItem('pending_room');
        sessionStorage.removeItem('pending_room_password');
      }
    } catch (_) { /* ignore */ }
    const resp = await emitWithAck('room:join', { code, password: invitePassword }, 5000).catch((e) => ({ ok: false, error: e.message }));
    if (!resp?.ok) {
      toast(resp?.error || (t('common.failed') || 'Xatolik'));
      return navigate('lobby');
    }
  }

  function leave() {
    socket.emit('room:leave', { code });
    navigate('lobby');
  }

  async function copyCode() {
    const url = `${location.origin}/?room=${code}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: 'Durak Imperia', text: `Stolga qo'shiling: ${code}`, url });
      } else {
        await navigator.clipboard.writeText(url);
        toast(t('common.copied') || 'Nusxalandi: ' + code, 'success');
      }
      sfx.play('click');
    } catch (e) {
      try {
        await navigator.clipboard.writeText(code);
        toast('Kod nusxalandi: ' + code, 'success');
      } catch (_) {
        toast(code, 'info');
      }
    }
  }

  async function openInviteFriends(room) {
    const modal = h('div', { class: 'modal invite-friends-modal room-invite-pro' });
    const bg = h('div', { class: 'modal-bg' }, [modal]);
    bg.addEventListener('click', (e) => { if (e.target === bg) bg.remove(); });
    body.appendChild(bg);

    let friends = [];
    let searchRows = [];
    let query = '';
    let loading = true;
    let searching = false;
    let searchTimer = null;
    let searchSeq = 0;
    const sentIds = new Set();

    const displayName = (user) => user?.nickname ? `@${user.nickname}` : (user?.username || 'player');
    const inviteKey = (user) => user?.id || user?.nickname || user?.username || '';

    function replaceChildren(node, children = []) {
      while (node.firstChild) node.removeChild(node.firstChild);
      for (const child of Array.isArray(children) ? children : [children]) {
        if (child) node.appendChild(child);
      }
    }

    function renderRows(list, emptyText, mode = 'friend') {
      if (!list.length) {
        return h('div', { class: 'room-invite-empty' }, [emptyText]);
      }
      return h('div', { class: 'room-invite-list' }, list.map((user) => {
        const key = inviteKey(user);
        const sent = sentIds.has(key);
        const accepted = user.status === 'accepted';
        return h('div', { class: 'invite-friend-row room-invite-row' }, [
          h('div', { class: `avatar sm color-${avatarColorFor(user.id)}` }, [
            user.avatar_url ? h('img', { src: user.avatar_url, alt: '', loading: 'lazy' }) : avatarLetter(user.username || user.nickname),
          ]),
          h('div', { class: 'grow invite-friend-name' }, [
            h('b', {}, [displayName(user)]),
            h('small', {}, [
              user.online ? 'Online' : (accepted ? 'Offline' : 'Global qidiruv'),
            ]),
          ]),
          h('button', {
            class: `btn-secondary room-invite-send ${sent ? 'sent' : ''}`,
            disabled: sent,
            onclick: async () => {
              const r = await sendInvite(user, accepted || mode === 'friend');
              if (r?.ok) {
                sentIds.add(key);
                renderResults();
              }
            },
          }, [sent ? 'Yuborildi' : 'Taklif']),
        ]);
      }));
    }

    async function sendInvite(user, byFriendId) {
      sfx.play('click');
      const payload = byFriendId
        ? { code, friendId: user.id }
        : { code, nickname: user.nickname || user.username };
      const r = await emitWithAck('room:invite', payload, 5000).catch((e) => ({ ok: false, error: e.message }));
      if (!r?.ok) {
        toast(r?.error || 'Taklif yuborilmadi', 'error');
        return r;
      }
      const label = displayName(r.user || user);
      if (r.delivered) toast(`${label}ga taklif yuborildi`, 'success');
      else if (r.pushed) toast(`${label}ga push xabar yuborildi`, 'success');
      else toast(`${label} hozir online emas. Taklif saqlandi.`, 'info');
      return r;
    }

    const titleNode = h('div', { class: 'room-invite-section-title' });
    const resultsNode = h('div', { class: 'room-invite-results' });
    const nickInput = h('input', {
      'data-invite-nick': '1',
      placeholder: "@nickname yoki ism yozing",
      maxlength: '24',
      autocomplete: 'off',
      autocapitalize: 'none',
      spellcheck: 'false',
      inputmode: 'text',
    });

    async function submitNicknameInvite() {
      const nickname = String(nickInput.value || '').trim().replace(/^@+/, '');
      if (!nickname) return toast('Nickname kiriting', 'error');
      const r = await emitWithAck('room:invite', { code, nickname }, 5000).catch((e) => ({ ok: false, error: e.message }));
      if (!r?.ok) return toast(r?.error || 'Taklif yuborilmadi', 'error');
      const label = r.user?.nickname ? `@${r.user.nickname}` : (r.user?.username || nickname);
      sentIds.add(r.user?.id || r.user?.nickname || nickname);
      if (r.delivered) toast(`${label}ga taklif yuborildi`, 'success');
      else if (r.pushed) toast(`${label}ga push xabar yuborildi`, 'success');
      else toast(`${label} hozir online emas. Taklif saqlandi.`, 'info');
      renderResults();
    }

    function renderResults() {
      const clean = query.trim().replace(/^@+/, '');
      if (clean.length >= 2) {
        titleNode.textContent = 'Butun oyin boyicha qidiruv';
        replaceChildren(resultsNode, searching
          ? h('div', { class: 'room-invite-empty' }, ['Qidirilmoqda...'])
          : renderRows(searchRows, 'Bunday oyinchi topilmadi', 'search'));
      } else {
        titleNode.textContent = "Do'stlaringiz";
        replaceChildren(resultsNode, loading
          ? h('div', { class: 'room-invite-empty' }, ['Yuklanmoqda...'])
          : renderRows(friends, "Hozircha do'stlar yo'q. Yuqoridan nickname qidiring.", 'friend'));
      }
    }

    function scheduleSearch() {
      if (searchTimer) clearTimeout(searchTimer);
      const clean = query.trim().replace(/^@+/, '');
      searchRows = [];
      if (clean.length < 2) {
        searchSeq += 1;
        searching = false;
        renderResults();
        return;
      }
      searching = true;
      renderResults();
      const seq = ++searchSeq;
      searchTimer = setTimeout(async () => {
        try {
          const rows = await api.roomInviteSearch(clean);
          if (seq !== searchSeq) return;
          searchRows = Array.isArray(rows) ? rows : [];
        } catch (e) {
          if (seq !== searchSeq) return;
          toast(e.message || 'Qidiruv ishlamadi', 'error');
          searchRows = [];
        }
        if (seq !== searchSeq) return;
        searching = false;
        renderResults();
      }, 260);
    }

    nickInput.addEventListener('input', (e) => {
      query = e.currentTarget.value;
      scheduleSearch();
    });
    nickInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submitNicknameInvite();
    });

    modal.appendChild(h('div', { class: 'room-invite-head' }, [
        h('div', {}, [
          h('h2', {}, ["Do'stlarni taklif qilish"]),
          h('p', {}, [room.isPrivate ? "Taklif olgan o'yinchi xonaga parolsiz kiradi." : 'Taklif yuboring yoki nickname orqali toping.']),
        ]),
        h('button', { class: 'btn-icon', title: 'Yopish', onclick: () => bg.remove() }, ['x']),
      ]));

    modal.appendChild(h('div', { class: 'invite-nick-box room-invite-search' }, [
        nickInput,
        h('button', {
          class: 'btn-secondary',
          onclick: submitNicknameInvite,
        }, ['Yuborish']),
      ]));

    modal.appendChild(titleNode);
    modal.appendChild(resultsNode);

    renderResults();
    try {
      friends = await api.roomInviteFriends();
    } catch (e) {
      toast(e.message || "Do'stlar ro'yxati yuklanmadi", 'error');
      friends = [];
    }
    loading = false;
    renderResults();
  }
  async function openPrivateRoom() {
    const r = await emitWithAck('room:open', { code }, 4000).catch((e) => ({ ok: false, error: e.message }));
    toast(r?.ok ? 'Stol ochildi' : (r?.error || 'Xatolik'), r?.ok ? 'success' : 'error');
  }

  function render(room) {
    body.innerHTML = '';
    actionBar.innerHTML = '';

    // ───── KOD KO'RSATISH (yopiq stol uchun ham, ochiq uchun ham) ─────
    const codeCard = h('div', { class: 'section-card room-code-card text-c' });
    codeCard.appendChild(h('div', {
      style: 'font-size:11px;color:rgba(255,231,164,.7);letter-spacing:.18em;font-weight:700;margin-bottom:6px'
    }, [room.isPrivate ? '🔒 YOPIQ STOL — TAKLIF KODI' : 'XONA KODI']));

    const codeRow = h('div', {
      style: 'display:flex;align-items:center;justify-content:center;gap:14px'
    }, [
      h('div', {
        style: `font-family:'Orbitron',monospace;font-size:42px;font-weight:900;
                letter-spacing:.18em;color:#ffe7a3;
                text-shadow:0 2px 1px #000,0 0 22px rgba(216,179,95,.5);
                background:linear-gradient(180deg,rgba(255,231,164,.12),rgba(0,0,0,.4));
                padding:8px 22px;border-radius:12px;
                border:2px solid rgba(216,179,95,.55);`
      }, [code]),
      h('button', {
        class: 'btn-icon', title: 'Nusxalash',
        style: 'width:46px;height:46px;font-size:18px',
        onclick: copyCode,
      }, ['📋']),
    ]);
    codeCard.appendChild(codeRow);

    codeCard.appendChild(h('div', {
      style: 'margin-top:10px;font-size:12px;color:rgba(255,255,255,.7)'
    }, [
      room.isPrivate
        ? "Do'stlaringizga shu kodni yuboring — kod orqali kirishadi"
        : "Bu xona ochiq, lobbyda ko'rinadi",
    ]));

    // Share tugmasi
    codeCard.appendChild(h('button', {
      class: 'btn-secondary',
      style: 'margin-top:10px;width:100%;padding:10px',
      onclick: copyCode,
    }, ['🔗  Do\'stlarga ulashish']));

    body.appendChild(codeCard);

    // ───── O'YIN PARAMETRLARI ─────
    const params = h('div', { class: 'section-card' }, [
      h('div', {
        style: 'display:flex;justify-content:space-around;gap:8px;flex-wrap:wrap'
      }, [
        infoBox('👥', `${room.maxPlayers} o\'yinchi`),
        infoBox('💰', `$${room.stake.toLocaleString()}`),
        infoBox('Cards', `${room.deckSize || 36} ta karta`),
        infoBox('Time', `${room.turnSeconds || 30}s`),
        room.transferEnabled ? infoBox('↻', 'Throw-in') : null,
        room.throwInMode === 'all' ? infoBox('ALL', 'Hamma tashlaydi') : null,
        room.bluffEnabled ? infoBox('🎭', 'Aldash YOQILGAN') : infoBox('✔️', 'Klassik'),
        room.isPrivate ? infoBox('🔒', 'Yopiq') : infoBox('🌐', 'Ochiq'),
      ]),
    ]);
    body.appendChild(params);

    if (room.isPrivate) {
      const privateTools = h('div', { class: 'section-card room-private-tools' }, [
        h('button', { class: 'btn-secondary', onclick: () => openInviteFriends(room) }, ["Do'stlarni taklif qilish"]),
        room.host?.id === state.user.id ? h('button', { class: 'btn-secondary', onclick: openPrivateRoom }, ['Stolni ochish']) : null,
      ].filter(Boolean));
      body.appendChild(privateTools);
    }

    // ───── O'YINCHILAR ─────
    const taken = room.seats.filter(Boolean).length;
    const seatsCard = h('div', { class: 'section-card' }, [
      h('h3', { style: 'margin:0 0 12px;font-family:Georgia,serif;color:#ffe7a3' },
        [`O\'yinchilar (${taken}/${room.maxPlayers})`]),
    ]);
    for (let i = 0; i < room.maxPlayers; i++) {
      const s = room.seats[i];
      if (s) {
        seatsCard.appendChild(h('div', { class: 'list-item' }, [
          h('div', { class: 'row gap-12' }, [
            h('div', { class: `avatar md color-${avatarColorFor(s.id)}` }, [avatarLetter(s.username)]),
            h('div', {}, [
              h('div', { style: 'font-weight:700;font-size:14px' }, [
                s.username,
                room.host?.id === s.id ? h('span', { class: 'badge gold', style: 'margin-left:6px;font-size:9px' }, ['HOST']) : null,
              ].filter(Boolean)),
              h('div', { class: 'muted', style: 'font-size:11px' },
                [s.ready ? '✓ Tayyor' : '⏳ Kutilmoqda']),
            ]),
          ]),
          s.ready
            ? h('div', { class: 'badge gold' }, ['TAYYOR'])
            : h('div', { class: 'muted', style: 'font-size:18px' }, ['…']),
        ]));
      } else {
        seatsCard.appendChild(h('div', { class: 'list-item empty-seat' }, [
          h('div', { class: 'muted' }, ['+ Bo\'sh joy — kutilmoqda']),
          h('div', { style: 'font-size:18px;color:rgba(255,255,255,.25)' }, ['…']),
        ]));
      }
    }
    body.appendChild(seatsCard);

    // ───── ACTION BUTTONS ─────
    const me = room.seats.find((s) => s && s.id === state.user.id);
    const seatedHumans = room.seats.filter((s) => s && !s.isBot);
    const allHumansReady = seatedHumans.length > 0 && seatedHumans.every((s) => s.ready);

    const ready = h('button', {
      class: `btn-big ${me?.ready ? '' : 'green'} mt-16`,
      onclick: () => {
        socket.emit('room:ready', { code, ready: !me?.ready });
        sfx.play('click');
      },
    }, [me?.ready ? '✗ Bekor qilish' : '✓ TAYYORMAN']);

    const isHost = room.host?.id === state.user.id;
    const privateWaiting = room.isPrivate && taken < room.maxPlayers;
    const canStart = isHost && !privateWaiting && allHumansReady;
    const startGame = h('button', {
      class: `btn-big green mt-16 room-start-btn ${canStart ? '' : 'disabled'}`,
      disabled: !canStart,
      onclick: async () => {
        if (!isHost) return toast('O\'yinni faqat host boshlaydi', 'info');
        if (privateWaiting) return toast("Avval do'stingizni taklif qiling yoki stolni oching.", 'info');
        if (!allHumansReady) return toast('Hamma o‘yinchi, host ham, TAYYORMAN bosishi kerak', 'info');
        sfx.play('click');
        const r = await emitWithAck('room:start', { code }).catch((e) => ({ ok: false, error: e.message }));
        if (!r?.ok) toast(r?.error || 'O\'yin boshlanmadi', 'error');
        if (r?.view) {
          state.game = r.view;
          navigate('game', { code });
        }
      },
    }, [isHost
      ? (privateWaiting ? "DO'STNI KUTING" : (allHumansReady ? 'O\'YINNI BOSHLASH' : 'HAMMA TAYYOR BO‘LSIN'))
      : 'HOST BOSHLASHINI KUTING']);

    const findOpponent = h('button', {
      class: 'btn-big mt-12',
      onclick: async () => {
        sfx.play('click');
        const r = await emitWithAck('room:fill-bots', { code }).catch(() => ({ ok: false }));
        if (!r?.ok) toast(r?.error || 'Raqib topib bo\'lmadi', 'error');
      },
    }, ['Qolgan joylarga raqib topish']);

    const leaveBtn = h('button', {
      class: 'btn-secondary mt-12',
      style: 'width:100%;padding:14px',
      onclick: () => leave(),
    }, ['Chiqish']);

    actionBar.appendChild(ready);
    actionBar.appendChild(startGame);
    if (room.isPrivate && isHost && taken < room.maxPlayers) {
      actionBar.appendChild(h('button', {
        class: 'btn-big mt-12 room-open-table-btn',
        onclick: async () => {
          sfx.play('click');
          await openPrivateRoom();
        },
      }, ['STOLNI OCHISH']));
    }
    if (!room.isPrivate && taken < room.maxPlayers) actionBar.appendChild(findOpponent);
    actionBar.appendChild(leaveBtn);
    requestAnimationFrame(updateScrollIndicator);
  }

  function updateScrollIndicator() {
    const thumb = scrollTrack.querySelector('.room-scroll-thumb');
    if (!thumb) return;
    const maxScroll = Math.max(0, body.scrollHeight - body.clientHeight);
    const canScroll = maxScroll > 4;
    scrollTrack.classList.toggle('visible', canScroll);
    if (!canScroll) {
      thumb.style.height = '0px';
      thumb.style.transform = 'translateY(0)';
      return;
    }
    const trackHeight = scrollTrack.clientHeight || 1;
    const thumbHeight = Math.max(44, Math.round((body.clientHeight / body.scrollHeight) * trackHeight));
    const maxThumbTop = Math.max(0, trackHeight - thumbHeight);
    const thumbTop = Math.round((body.scrollTop / maxScroll) * maxThumbTop);
    thumb.style.height = `${thumbHeight}px`;
    thumb.style.transform = `translateY(${thumbTop}px)`;
  }

  function infoBox(icon, txt) {
    return h('div', {
      style: 'display:flex;flex-direction:column;align-items:center;gap:4px;padding:8px 10px;min-width:80px'
    }, [
      h('div', { style: 'font-size:22px' }, [icon]),
      h('div', { style: 'font-size:11px;color:rgba(255,231,164,.9);font-weight:700;text-align:center' }, [txt]),
    ]);
  }

  let renderFrame = 0;
  let pendingRoom = null;
  let lastLobbySignature = '';

  const onRoomState = (room) => {
    if (room.code !== code) return;
    if (room.phase !== 'lobby') return;
    const seats = (room.seats || []).map((s) => s ? `${s.id}:${s.ready ? 1 : 0}` : '0').join('|');
    const signature = [
      room.code,
      room.phase,
      room.host?.id || '',
      room.isPrivate ? 1 : 0,
      room.maxPlayers,
      room.stake,
      seats,
    ].join(':');
    if (signature === lastLobbySignature) return;
    lastLobbySignature = signature;
    pendingRoom = room;
    if (renderFrame) return;
    renderFrame = requestAnimationFrame(() => {
      renderFrame = 0;
      if (pendingRoom) render(pendingRoom);
    });
  };

  const onGameStart = (gameView) => {
    state.game = gameView;
    sfx.play('deal');
    navigate('game', { code });
  };
  const onRoomError = ({ error }) => {
    toast(error || 'Xatolik', 'error');
  };
  const onHostChanged = ({ newHostUsername }) => {
    toast(`Yangi host: ${newHostUsername}`, 'info');
  };

  socket.on('room:state', onRoomState);
  socket.on('game:start', onGameStart);
  socket.on('room:error', onRoomError);
  socket.on('room:host_changed', onHostChanged);
  body.addEventListener('scroll', updateScrollIndicator, { passive: true });
  window.addEventListener('resize', updateScrollIndicator);

  // Birinchi marta yuklash
  socket.emit('rooms:list');

  return () => {
    if (renderFrame) cancelAnimationFrame(renderFrame);
    body.removeEventListener('scroll', updateScrollIndicator);
    window.removeEventListener('resize', updateScrollIndicator);
    socket.off('room:state', onRoomState);
    socket.off('game:start', onGameStart);
    socket.off('room:error', onRoomError);
    socket.off('room:host_changed', onHostChanged);
  };
}
