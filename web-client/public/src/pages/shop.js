import { h } from '../ui.js';
import { api } from '../api.js';
import { state, toast } from '../state.js';
import { navigate } from '../router.js';
import { sfx } from '../sfx.js?v=164-i18n-audio';
import { cardSkinClass, cardSkinStyle } from '../cards.js?v=160-curated-card-skins';
import { setPref } from '../preferences.js?v=164-i18n-audio';
import { native, buyProduct, submitReceiptToBackend } from '../native/capacitor-bridge.js';
import { t } from '../i18n.js';

let TAB = 'featured';
let OWNED_FRAME_IDS = new Set();
let OWNED_SKIN_IDS = new Set();
let OWNED_STICKER_IDS = new Set();
let OWNED_EMOJI_PACK_IDS = new Set();
let SHOP_CACHE = {
  goldBundles: [],
  dollarBundles: [],
  premiumTiers: [],
};

const RARITY_LABEL = {
  common: 'Oddiy',
  uncommon: 'Premium',
  rare: 'Noyob',
  epic: 'Epic',
  legendary: 'Legenda',
};

const PACK_ICON = {
  'Wolf Pack': '🐺',
  'Space Cats': '🚀',
  'Pixel Heroes': '🎮',
  'Neon Dragons': '🐉',
  'Pirate Crew': '☠️',
  'Ninja Squad': '🥷',
  'Knight Order': '🛡️',
  'Robot Army': '🤖',
  'Forest Spirits': '🌲',
  'Mermaid Tales': '🧜',
  'Vampire Lords': '🧛',
  'Mythic Beasts': '🦄',
  'Cyber Punks': '🕶️',
  'Old West': '🤠',
  'Galaxy Guards': '🌌',
};

function tSafe(key, fallback) {
  const value = t(key);
  return value && value !== key ? value : fallback;
}

export async function renderShop(root, params = {}) {
  root.innerHTML = '';

  try { state.user = await api.me(); } catch (_) {}
  const checkoutNotice = await resolveCheckoutNotice(params);
  if (checkoutNotice?.refreshUser) {
    try { state.user = await api.me(); } catch (_) {}
  }
  const me = state.user || {};
  const isPremium = !!(me.premium_until && new Date(me.premium_until) > new Date());

  const wrap = h('div', { class: 'screen bg-lobby shop-screen' });
  wrap.appendChild(renderTopbar(me));
  wrap.appendChild(renderWallet(me, isPremium));

  const body = h('div', { class: 'scroll shop-body' });
  body.appendChild(h('div', { class: 'shop-loading' }, [tSafe('shop.loading', 'Yuklanmoqda...')]));
  wrap.appendChild(h('div', { class: 'shop-layout' }, [
    h('aside', { class: 'shop-side-panel' }, [
      renderTabs(root),
      renderSideOffer(root),
    ]),
    body,
  ]));
  root.appendChild(wrap);

  try {
    const [catalog, goldBundles, dollarBundles, premiumTiers, stickerPacks, inventory, donationConfig] = await Promise.all([
      api.catalog().catch(() => ({ emojiPacks: [], cardSkins: [], profileFrames: [] })),
      api.goldBundles().catch(() => []),
      api.dollarBundles().catch(() => []),
      api.premiumTiers().catch(() => []),
      api.stickerPacks().catch(() => []),
      api.inventory().catch(() => []),
      api.donationsConfig().catch(() => ({ minDonationUsd: 0.5, minDonationUsdCents: 50 })),
    ]);
    body.innerHTML = '';
    if (checkoutNotice) body.appendChild(renderCheckoutNotice(checkoutNotice));
    const safeCatalog = normalizeCatalog(catalog);
    const safeGoldBundles = normalizeList(goldBundles);
    const safeDollarBundles = normalizeList(dollarBundles);
    const safePremiumTiers = normalizeList(premiumTiers);
    const safeStickerPacks = normalizeList(stickerPacks);
    SHOP_CACHE = { goldBundles: safeGoldBundles, dollarBundles: safeDollarBundles, premiumTiers: safePremiumTiers };
    const inventoryItems = normalizeInventoryItems(inventory);
    OWNED_FRAME_IDS = new Set(inventoryItems
      .filter((i) => i.item_type === 'avatar_frame' || i.item_type === 'frame')
      .map((i) => i.item_id));
    OWNED_SKIN_IDS = new Set(inventoryItems
      .filter((i) => i.item_type === 'card_skin')
      .map((i) => i.item_id));
    OWNED_STICKER_IDS = new Set(inventoryItems
      .filter((i) => i.item_type === 'sticker_pack')
      .map((i) => i.item_id));
    OWNED_EMOJI_PACK_IDS = new Set(inventoryItems
      .filter((i) => i.item_type === 'emoji' || i.item_type === 'emoji_pack')
      .map((i) => i.item_type === 'emoji_pack' ? String(i.item_id || '') : String(i.item_id || '').split(':')[0])
      .filter(Boolean));

    if (TAB === 'featured') renderFeatured(body, root, {
      me,
      isPremium,
      catalog: safeCatalog,
      goldBundles: safeGoldBundles,
      dollarBundles: safeDollarBundles,
      premiumTiers: safePremiumTiers,
      stickerPacks: safeStickerPacks,
      donationConfig,
    });
    else if (TAB === 'gold') renderGold(body, root, safeGoldBundles, me);
    else if (TAB === 'dollars') renderDollars(body, root, safeDollarBundles, me);
    else if (TAB === 'premium') renderPremium(body, root, safePremiumTiers, me, isPremium);
    else if (TAB === 'emoji') renderEmojiAndStickers(body, root, safeCatalog.emojiPacks, safeStickerPacks, me, isPremium);
    else if (TAB === 'cards') renderCardSkins(body, root, safeCatalog.cardSkins, me, isPremium);
    else if (TAB === 'stickers') renderStickers(body, root, safeStickerPacks, me, isPremium);
    else if (TAB === 'frames') renderProfileFrames(body, root, safeCatalog.profileFrames, me);
    else if (TAB === 'donations') renderDonations(body, root, donationConfig, me);
  } catch (e) {
    body.innerHTML = '';
    body.appendChild(h('div', { class: 'shop-empty' }, [e.message || tSafe('shop.load_failed', 'Do\'kon yuklanmadi')]));
  }
}

async function resolveCheckoutNotice(params = {}) {
  const payment = String(params.payment || params.checkout || params.status || '').toLowerCase();
  const sessionId = String(params.session_id || params.sessionId || '').trim();
  if (payment === 'cancel' || payment === 'cancelled') {
    return { type: 'cancel', text: "To'lov bekor qilindi. Pul yechilmadi." };
  }
  if (payment !== 'success') return null;
  if (!sessionId) return { type: 'error', text: "To'lov qaytdi, lekin session_id topilmadi. Admin bilan bog'laning." };
  const key = `durak.stripe.fulfilled.${sessionId}`;
  try {
    const result = await api.fulfillStripeCheckout(sessionId);
    const duplicate = !!result?.duplicate || sessionStorage.getItem(key) === '1';
    sessionStorage.setItem(key, '1');
    if (result?.type === 'gold_bundle') {
      return {
        type: 'success',
        refreshUser: true,
        text: duplicate ? 'Bu Gold Coin xaridi oldin hisobga yozilgan.' : `Gold Coin balansga qo'shildi: +${fmt(result.awardedGoldCoins || 0)} GC.`,
      };
    }
    if (result?.type === 'premium') {
      return {
        type: 'success',
        refreshUser: true,
        text: duplicate ? 'Bu Premium xaridi oldin faollashtirilgan.' : `Premium faollashtirildi: ${fmt(result.premiumDays || 0)} kun.`,
      };
    }
    if (result?.type === 'donation') {
      return {
        type: 'success',
        refreshUser: true,
        text: duplicate ? 'Bu donat oldin hisobga olingan.' : 'Rahmat! Donatingiz ro‘yxatga qo‘shildi.',
      };
    }
    return { type: 'success', refreshUser: true, text: "To'lov muvaffaqiyatli tasdiqlandi." };
  } catch (e) {
    if (sessionStorage.getItem(key) === '1') {
      return { type: 'success', refreshUser: true, text: "To'lov oldin tasdiqlangan." };
    }
    return { type: 'error', text: e.message || "To'lovni tasdiqlashda xatolik bo'ldi." };
  }
}

function renderCheckoutNotice(notice) {
  const className = notice.type === 'success' ? 'success' : notice.type === 'cancel' ? 'cancel' : 'error';
  const icon = notice.type === 'success' ? '✓' : notice.type === 'cancel' ? '!' : '!';
  return h('div', { class: `payment-banner ${className}` }, [`${icon} ${notice.text}`]);
}

function normalizeInventoryItems(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.inventory)) return payload.inventory;
  if (Array.isArray(payload?.owned)) return payload.owned;
  return [];
}

function normalizeList(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.packs)) return payload.packs;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
}

function normalizeCatalog(payload) {
  return {
    emojiPacks: normalizeList(payload?.emojiPacks),
    cardSkins: normalizeList(payload?.cardSkins),
    profileFrames: normalizeList(payload?.profileFrames),
  };
}

function renderTopbarLegacy(me) {
  return h('div', { class: 'lobby-topbar shop-topbar' }, [
    h('button', { class: 'btn-icon', onclick: () => { sfx.play('click'); navigate('home'); } }, ['‹']),
    h('div', { class: 'title' }, [tSafe('shop.title', 'Do\'kon')]),
    h('div', { class: 'coins' }, [`$${fmt(me.coins || 0)}`]),
  ]);
}

function renderTopbar(me) {
  return h('div', { class: 'lobby-topbar shop-topbar' }, [
    h('button', { class: 'btn-icon', onclick: () => { sfx.play('click'); navigate('home'); } }, ['‹']),
    h('div', { class: 'shop-title-wrap' }, [
      h('div', { class: 'title' }, [tSafe('shop.title', 'Shop')]),
      h('small', {}, ['Durak Imperia']),
    ]),
    h('div', { class: 'shop-top-balances' }, [
      h('span', {}, [`GC ${fmt(me.gold_coins || 0)}`]),
      h('span', {}, [`$ ${fmt(me.coins || 0)}`]),
    ]),
  ]);
}

function renderWallet(me, isPremium) {
  return h('div', { class: 'shop-wallet' }, [
    walletPill('⚡', `${fmt(me.gold_coins || 0)} GC`, tSafe('shop.gold_coins', 'Gold Coin')),
    walletPill('$', fmt(me.coins || 0), tSafe('shop.dollars', 'Durak Dollar')),
    walletPill(isPremium ? '★' : '☆', isPremium ? tSafe('shop.premium', 'Premium') : tSafe('shop.ordinary', 'Oddiy'), premiumUntilText(me.premium_until)),
  ]);
}

function walletPill(icon, value, label) {
  return h('div', { class: 'shop-wallet-pill' }, [
    h('span', { class: 'wallet-icon' }, [icon]),
    h('span', { class: 'wallet-value' }, [value]),
    h('span', { class: 'wallet-label' }, [label]),
  ]);
}

function renderTabsLegacy(root) {
  const tabs = [
    ['gold', '⚡', 'Gold'],
    ['dollars', '$', 'Dollar'],
    ['premium', '★', 'Premium'],
    ['emoji', '☺', 'Emoji'],
    ['cards', '♠', 'Karta'],
    ['stickers', '◆', 'Stiker'],
    ['frames', '\u25CB', 'Profil'],
  ];
  const el = h('div', { class: 'shop-tabs' });
  for (const [key, icon, label] of tabs) {
    el.appendChild(h('button', {
      class: `shop-tab${TAB === key ? ' active' : ''}`,
      onclick: () => { sfx.play('click'); TAB = key; renderShop(root); },
    }, [h('span', {}, [icon]), h('b', {}, [label])]));
  }
  return el;
}

function renderTabs(root) {
  const tabs = [
    ['featured', '★', tSafe('shop.featured', 'Tavsiya')],
    ['gold', 'GC', tSafe('shop.gold_coins', 'Gold Coin')],
    ['premium', '♛', tSafe('shop.premium', 'Premium')],
    ['cards', 'A♠', tSafe('shop.cards', 'Kartalar')],
    ['stickers', '3D', tSafe('shop.stickers', 'Stiker')],
    ['emoji', '☺', tSafe('shop.emoji', 'Emoji')],
    ['frames', '◎', tSafe('shop.frames', 'Profil')],
    ['dollars', '$', tSafe('shop.dollars_exchange', 'Dollar almashish')],
    ['donations', '+', tSafe('shop.donations', 'Donat')],
  ];
  const el = h('div', { class: 'shop-tabs' });
  for (const [key, icon, label] of tabs) {
    el.appendChild(h('button', {
      class: `shop-tab${TAB === key ? ' active' : ''}`,
      onclick: () => { sfx.play('click'); TAB = key; renderShop(root); },
    }, [h('span', {}, [icon]), h('b', {}, [label])]));
  }
  return el;
}

function renderSideOffer(root) {
  return h('div', { class: 'shop-side-offer' }, [
    h('small', {}, [tSafe('shop.special_offer', 'Maxsus taklif')]),
    h('strong', {}, ['Legendary Pack']),
    h('p', {}, [tSafe('shop.side_offer_text', 'Gold Coin, premium va donat imkoniyatlari bitta vitrinda.')]),
    h('button', {
      onclick: () => { sfx.play('click'); TAB = 'donations'; renderShop(root); },
    }, [tSafe('shop.donate_button', 'Donat qilish')]),
  ]);
}

function renderGold(body, root, bundles, me = {}) {
  body.appendChild(hero('Gold Coin', 'Real pulga olinadigan yagona premium valyuta. Keyin uni skin, sticker, premium va Durak Dollarga almashtirasiz.', `${fmt(me.gold_coins || 0)} GC mavjud`));
  body.appendChild(renderGoldBundleSection(root, bundles, 'Gold Coin paketlari', 'To‘lov Stripe / Google Play orqali tasdiqlangandan keyin balansga tushadi.'));
  return;
  body.appendChild(hero('Gold Coin', 'Premium valyuta: turnir, perk, sticker va Dollar almashtirish uchun.', 'Real to‘lov ulanganda beriladi'));
  for (const b of bundles) {
    body.appendChild(row({
      icon: '⚡',
      title: `${fmt(b.goldCoins)} Gold Coins`,
      subtitle: `$${fmt(b.dollarsEquiv)} ekvivalent`,
      meta: `$${money(b.priceUsd)}`,
      cta: 'Sotib olish',
      onClick: () => openShopCheckout(root, {
        type: 'gold_bundle',
        id: b.id,
        title: `${fmt(b.goldCoins)} Gold Coin`,
        subtitle: `$${fmt(b.dollarsEquiv)} ekvivalent`,
        price: `$${money(b.priceUsd)}`,
      }),
    }));
  }
}

function renderFeatured(body, root, data) {
  const { me, isPremium, catalog, goldBundles, dollarBundles, premiumTiers, stickerPacks, donationConfig } = data;
  body.appendChild(renderPremiumBanner(root, isPremium));
  body.appendChild(renderGoldBundleSection(root, goldBundles, 'Gold Coin paketlari', 'Haqiqiy pulga faqat Gold Coin olinadi.', 5));
  body.appendChild(renderFeatureTiles(root, { premiumTiers, goldBundles, dollarBundles, donationConfig }));
  body.appendChild(renderPremiumPlans(root, premiumTiers, me, isPremium, true));
  body.appendChild(renderMiniCatalog(root, catalog, stickerPacks, me, isPremium));
}

function renderPremiumBanner(root, isPremium) {
  return h('section', { class: 'shop-premium-hero' }, [
    h('div', { class: 'shop-premium-copy' }, [
      h('small', {}, ['Durak Imperia']),
      h('h1', {}, ['Premium']),
      h('p', {}, [isPremium ? 'Premium faol. Muddatni uzaytirib imtiyozlarni saqlang.' : 'Reklamasiz o‘yin, maxsus nishon, premium chat belgilari va kolleksiya imkoniyatlari.']),
      h('div', { class: 'shop-premium-perk-row' }, [
        perk('No Ads', 'Reklamasiz'),
        perk('Crown', 'Nishon'),
        perk('GC+', 'Bonus'),
        perk('Cards', 'Maxsus karta'),
      ]),
      h('button', { class: 'shop-outline-btn', onclick: () => { sfx.play('click'); TAB = 'premium'; renderShop(root); } }, ['Batafsil']),
    ]),
    h('div', { class: 'shop-premium-art' }, [
      h('span', {}, ['A']),
      h('b', {}, ['♠']),
    ]),
  ]);
}

function perk(icon, label) {
  return h('span', {}, [h('b', {}, [icon]), h('small', {}, [label])]);
}

function renderGoldBundleSection(root, bundles, title, subtitle, limit = 99) {
  const cards = (bundles || []).slice(0, limit).map((b, index) => goldBundleCard(root, b, index));
  return h('section', { class: 'shop-section shop-gold-section' }, [
    h('div', { class: 'shop-section-head' }, [
      h('div', {}, [h('h2', {}, [title]), h('p', {}, [subtitle])]),
      h('button', { onclick: () => { sfx.play('click'); TAB = 'gold'; renderShop(root); } }, ['Barchasi']),
    ]),
    h('div', { class: 'shop-gold-grid' }, cards.length ? cards : [h('div', { class: 'shop-empty' }, ['Gold Coin paketlari yo‘q'])]),
  ]);
}

function goldBundleCard(root, b, index) {
  const bonus = ['', '+25%', '+50%', '+100%', '+150%'][index] || '';
  const art = ['coin-stack', 'coin-pile', 'coin-bag', 'coin-chest', 'coin-legend'][index] || 'coin-stack';
  return h('button', {
    class: `shop-gold-card ${art}`,
    onclick: () => openShopCheckout(root, {
      type: 'gold_bundle',
      id: b.id,
      title: `${fmt(b.goldCoins)} Gold Coin`,
      subtitle: `$${fmt(b.dollarsEquiv)} Durak Dollar ekvivalenti`,
      price: `$${money(b.priceUsd)}`,
    }),
  }, [
    h('em', { class: bonus ? '' : 'blank' }, [bonus]),
    h('div', { class: 'gold-card-art' }, [h('span', {}, ['GC'])]),
    h('strong', {}, [fmt(b.goldCoins)]),
    h('small', {}, [`${fmt(b.goldCoins)} Gold`]),
    h('b', {}, [`$${money(b.priceUsd)}`]),
  ]);
}

function renderFeatureTiles(root, { goldBundles, dollarBundles, donationConfig }) {
  const cheapest = goldBundles?.[0];
  const dollar = dollarBundles?.[0];
  const donationCents = Math.max(50, Number(donationConfig?.minDonationUsdCents || 50));
  return h('section', { class: 'shop-feature-grid' }, [
    featureTile('Premium obuna', 'Reklamasiz o‘yin, maxsus rang va premium to‘plamlar.', 'Premium', 'premium', () => { TAB = 'premium'; renderShop(root); }),
    featureTile('Maxsus takliflar', cheapest ? `${fmt(cheapest.goldCoins)} GC paketidan boshlang.` : 'Gold Coin paketlari.', 'Ko‘rish', 'offer', () => { TAB = 'gold'; renderShop(root); }),
    featureTile('Dollar almashish', dollar ? `${fmt(dollar.costGoldCoins)} GC -> $${fmt(dollar.dollars)}` : 'Gold Coinni Durak Dollarga almashtiring.', 'Almashish', 'dollar', () => { TAB = 'dollars'; renderShop(root); }),
    featureTile('Donat', `Minimal $${money(donationCents / 100)}. Loyihani rivojlantirishga yordam beradi.`, 'Donat', 'donate', () => { TAB = 'donations'; renderShop(root); }),
  ]);
}

function featureTile(title, text, cta, theme, onClick) {
  return h('button', { class: `shop-feature-tile ${theme}`, onclick: () => { sfx.play('click'); onClick(); } }, [
    h('span', { class: 'feature-art' }, ['']),
    h('h3', {}, [title]),
    h('p', {}, [text]),
    h('b', {}, [cta]),
  ]);
}

function openShopCheckout(root, item) {
  sfx.play('click');
  const bg = h('div', { class: 'profile-modal-bg shop-checkout-bg' });
  let cardEnabled = true;
  let payButton = null;
  let nativeButton = null;
  const nativeCheckout = native.isNative?.() && item.id;
  const box = h('div', { class: 'payment-sheet shop-checkout-sheet' }, [
    h('button', { class: 'profile-modal-close', onclick: () => bg.remove() }, ['×']),
    h('div', { class: 'payment-sheet-head' }, [
      h('span', { class: 'payment-brand-mark' }, ['D']),
      h('div', {}, [
        h('h2', {}, ['To‘lov']),
        h('p', {}, ['Visa / Mastercard orqali xavfsiz checkout.']),
      ]),
    ]),
    h('button', {
      type: 'button',
      class: 'payment-method-card',
      onclick: () => payButton?.click(),
    }, [
      h('span', {}, ['VISA']),
      h('div', {}, [
        h('strong', {}, ['Visa karta']),
        h('small', {}, ['Karta ma’lumotlari checkout oynasida kiritiladi.']),
      ]),
      h('b', {}, ['›']),
    ]),
    (nativeButton = h('button', {
      type: 'button',
      class: `payment-google-row${nativeCheckout ? ' active' : ' disabled'}`,
      onclick: async () => {
        sfx.play('click');
        if (!nativeCheckout) {
          toast('Google Play xaridi faqat Android ilovada ishlaydi. Brauzerda Visa kartani tanlang.', 'info', 4200);
          return;
        }
        nativeButton?.setAttribute('disabled', '');
        try {
          const purchase = await buyProduct(item.id);
          if (!purchase?.ok) throw new Error(purchase?.error || 'Google Play xaridi ochilmadi');
          await submitReceiptToBackend(api, purchase);
          toast('Xarid tasdiqlandi, balans yangilanmoqda', 'success');
          bg.remove();
          renderShop(root);
        } catch (e) {
          nativeButton?.removeAttribute('disabled');
          toast(e.message || 'Google Play xaridi yakunlanmadi', 'error');
        }
      },
    }, [nativeCheckout ? 'Google Play Billing' : 'Google Play faqat ilovada'])),
    (payButton = h('button', {
      class: 'payment-option featured-payment-option',
      onclick: async () => {
        sfx.play('click');
        if (!cardEnabled) {
          toast('Visa / Mastercard uchun Stripe kalitlari serverda sozlanmagan', 'info', 3600);
          return;
        }
        try {
          const r = await api.stripeCheckout(item.type, item.id, {
            amountUsdCents: item.amountUsdCents,
            message: item.message || '',
            successPath: '/#/shop?checkout=success',
            cancelPath: '/#/shop?checkout=cancel',
          });
          if (r?.url) window.location.href = r.url;
          else toast('To‘lov provayderi ulanmagan. Gold Coin faqat IAP/Stripe orqali beriladi.', 'info', 3600);
        } catch (e) {
          toast(paymentErrorMessage(e), 'error');
        }
      },
    }, [
      h('strong', {}, [item.title]),
      h('span', {}, [item.price]),
    ])),
    h('div', { class: 'payment-sheet-note' }, ['Xarid tugasa balans avtomatik profilga qo‘shiladi.']),
  ]);
  bg.appendChild(box);
  root.appendChild(bg);
  const disableCardCheckout = (message = 'Visa / Mastercard hozir serverda ulanmagan. STRIPE_SECRET_KEY kerak.') => {
    cardEnabled = false;
    box.querySelector('.payment-method-card')?.classList.add('disabled');
    const note = box.querySelector('.payment-sheet-note');
    note?.classList.add('error');
    if (note) note.textContent = message;
    payButton?.setAttribute('disabled', '');
    payButton?.classList.add('disabled');
  };
  api.paymentConfig().then((cfg) => {
    cardEnabled = nativeCheckout ? false : !!cfg.cardEnabled;
    if (!cardEnabled) {
      disableCardCheckout(nativeCheckout
        ? 'Play Market ilovasida raqamli xaridlar Google Play Billing orqali qilinadi.'
        : undefined);
    }
  }).catch(() => {
    disableCardCheckout('To‘lov konfiguratsiyasi yuklanmadi. Backend /api/payments/config routeini tekshiring.');
  });
}

function paymentErrorMessage(err) {
  if (err?.status === 503) return 'Visa / Mastercard to‘lovlari serverda sozlanmagan.';
  if (err?.status === 409) return 'Bu paket narxi hali tasdiqlanmagan.';
  return err?.message || 'To‘lov hozircha ishlamayapti';
}

function cheapestGoldBundleFor(requiredGold) {
  const bundles = [...(SHOP_CACHE.goldBundles || [])].sort((a, b) => Number(a.goldCoins || 0) - Number(b.goldCoins || 0));
  return bundles.find((b) => Number(b.goldCoins || 0) >= Number(requiredGold || 0)) || bundles[0] || null;
}

function openNeedGold(root, requiredGold, title = 'Gold Coin kerak') {
  const bundle = cheapestGoldBundleFor(requiredGold);
  if (!bundle) {
    toast('Gold Coin paketlari yuklanmadi', 'error');
    return;
  }
  openShopCheckout(root, {
    type: 'gold_bundle',
    id: bundle.id,
    title: `${fmt(bundle.goldCoins)} Gold Coin`,
    subtitle: `${title}: ${fmt(requiredGold)} GC kerak`,
    price: `$${money(bundle.priceUsd)}`,
  });
}

function openPremiumCheckout(root, plan) {
  openNeedGold(root, Number(plan.priceGoldCoins || 0), `${plan.name} uchun`);
}

function openNeedDollars(root, requiredDollars) {
  sfx.play('click');
  const bg = h('div', { class: 'profile-modal-bg shop-checkout-bg' });
  const box = h('div', { class: 'payment-sheet shop-checkout-sheet' }, [
    h('button', { class: 'profile-modal-close', onclick: () => bg.remove() }, ['×']),
    h('div', { class: 'payment-sheet-head' }, [
      h('span', { class: 'payment-brand-mark' }, ['$']),
      h('div', {}, [
        h('h2', {}, ['Dollar kerak']),
        h('p', {}, [`Bu xarid uchun $${fmt(requiredDollars)} Durak Dollar kerak.`]),
      ]),
    ]),
    h('button', {
      class: 'payment-option featured-payment-option',
      onclick: () => {
        bg.remove();
        TAB = 'dollars';
        renderShop(root);
      },
    }, [
      h('strong', {}, ['Dollar almashtirish oynasi']),
      h('span', {}, ['Gold Coin orqali']),
    ]),
    h('button', {
      class: 'payment-option',
      onclick: () => {
        bg.remove();
        openNeedGold(root, 55, 'Dollar olish uchun Gold Coin');
      },
    }, [
      h('strong', {}, ['Gold Coin sotib olish']),
      h('span', {}, ['Real tolov']),
    ]),
    h('div', { class: 'payment-sheet-note' }, ['Gold Coin olgandan keyin Dollar bolimida Durak Dollarga almashtirasiz.']),
  ]);
  bg.appendChild(box);
  root.appendChild(bg);
}

function renderDollars(body, root, bundles, me) {
  body.appendChild(hero('Dollar almashtirish', 'Gold Coin aniq nisbatda Durak Dollar hisobiga o‘tadi.', `${fmt(me.gold_coins || 0)} GC mavjud`));
  for (const b of bundles) {
    const disabled = Number(me.gold_coins || 0) < Number(b.costGoldCoins || 0);
    body.appendChild(row({
      icon: '$',
      title: `$${fmt(b.dollars)}`,
      subtitle: `Hisobdan ${fmt(b.costGoldCoins)} GC yechiladi`,
      meta: `⚡ ${fmt(b.costGoldCoins)}`,
      cta: disabled ? 'Yetmaydi' : 'Almashtirish',
      disabled,
      onClick: async () => {
        if (disabled) return openNeedGold(root, Number(b.costGoldCoins || 0), 'Dollar almashtirish uchun');
        await buyAndRefresh(root, () => api.buyDollarBundle(b.id), (r) => {
          state.user.coins = r.coins;
          state.user.gold_coins = r.goldCoins;
          return `+$${fmt(r.awarded)} qo‘shildi`;
        });
      },
    }));
  }
}

function renderPremiumLegacy(body, root, plans, me, isPremium) {
  body.appendChild(hero('Premium Club', isPremium ? 'Premium faol. Muddatni uzaytirishingiz mumkin.' : 'Premium emoji, sticker va eksklyuziv chat imkoniyatlari.', premiumUntilText(me.premium_until)));
  const perks = ['Reklamasiz o‘yin', 'Premium emoji va stickerlar', '2-3 kishilik xonada media chat', 'Eksklyuziv karta dizaynlari', 'Profil premium belgisi'];
  for (const plan of plans) {
    const disabled = Number(me.gold_coins || 0) < Number(plan.priceGoldCoins || 0);
    const card = h('div', { class: 'shop-premium-card' }, [
      h('div', { class: 'premium-head' }, [
        h('div', {}, [
          h('div', { class: 'premium-kicker' }, [`${plan.days} kun`]),
          h('h2', {}, [plan.name]),
        ]),
        h('div', { class: 'premium-price' }, [`⚡ ${fmt(plan.priceGoldCoins)} GC`]),
      ]),
      h('div', { class: 'premium-perks' }, perks.map((p) => h('span', {}, [`✓ ${p}`]))),
      h('button', {
        class: 'shop-buy wide',
        onclick: async () => {
          if (disabled) return openPremiumCheckout(root, plan);
          await buyAndRefresh(root, () => api.buyPremium(plan.id, true), (r) => {
            state.user.gold_coins = r.goldCoins;
            state.user.premium_until = r.premium_until;
            return `${plan.name} faollashtirildi`;
          });
        },
      }, [disabled ? `⚡ ${fmt(plan.priceGoldCoins)} yetmaydi` : `⚡ ${fmt(plan.priceGoldCoins)} GC bilan olish`]),
    ]);
    body.appendChild(card);
  }
}

function renderPremium(body, root, plans, me, isPremium) {
  body.appendChild(hero('Premium Club', isPremium ? 'Premium faol. Muddatni uzaytirishingiz mumkin.' : 'Premium emoji, sticker va eksklyuziv chat imkoniyatlari.', premiumUntilText(me.premium_until)));
  body.appendChild(renderPremiumPlans(root, plans, me, isPremium));
}

function renderPremiumPlans(root, plans, me, isPremium, compact = false) {
  const perks = ['Reklamasiz o‘yin', 'Premium emoji va stickerlar', 'Maxsus profil belgisi', 'Eksklyuziv karta dizaynlari', 'Ko‘proq XP va mukofotlar'];
  const gridEl = h('div', { class: 'premium-plan-grid' });
  for (const plan of plans) {
    const disabled = Number(me.gold_coins || 0) < Number(plan.priceGoldCoins || 0);
    gridEl.appendChild(h('div', { class: 'shop-premium-card' }, [
      h('div', { class: 'premium-head' }, [
        h('div', {}, [
          h('div', { class: 'premium-kicker' }, [`${plan.days} kun`]),
          h('h2', {}, [plan.name]),
        ]),
        h('div', { class: 'premium-price' }, [`GC ${fmt(plan.priceGoldCoins)}`]),
      ]),
      h('div', { class: 'premium-perks' }, perks.map((p) => h('span', {}, [`✓ ${p}`]))),
      h('button', {
        class: 'shop-buy wide',
        onclick: async () => {
          if (disabled) return openPremiumCheckout(root, plan);
          await buyAndRefresh(root, () => api.buyPremium(plan.id, true), (r) => {
            state.user.gold_coins = r.goldCoins;
            state.user.premium_until = r.premium_until;
            return `${plan.name} faollashtirildi`;
          });
        },
      }, [disabled ? `GC ${fmt(plan.priceGoldCoins)} yetmaydi` : `GC ${fmt(plan.priceGoldCoins)} bilan olish`]),
    ]));
  }
  if (!plans.length) gridEl.appendChild(h('div', { class: 'shop-empty' }, ['Premium rejalari yo‘q']));
  return h('section', { class: `shop-section premium-plan-section${compact ? ' compact' : ''}` }, [
    h('div', { class: 'shop-section-head' }, [
      h('div', {}, [h('h2', {}, ['Premium obuna']), h('p', {}, [isPremium ? 'Faol muddatni uzaytirish mumkin.' : 'Premium Gold Coin bilan faollashadi.'])]),
      compact ? h('button', { onclick: () => { sfx.play('click'); TAB = 'premium'; renderShop(root); } }, ['Barchasi']) : h('span', {}, ['']),
    ]),
    gridEl,
  ]);
}

function renderEmojiAndStickersLegacy(body, root, packs, stickerPacks, me, isPremium) {
  body.appendChild(hero('Emoji & Sticker', 'O‘yinda chat va stol ustida ishlatiladigan premium to‘plamlar. Hammasi Gold Coin bilan olinadi.', `${fmt(me.gold_coins || 0)} GC mavjud`));
  renderEmoji(body, root, packs, me, isPremium);
  renderStickers(body, root, stickerPacks, me, isPremium);
}

function renderMiniCatalog(root, catalog, stickerPacks, me, isPremium) {
  const emoji = (catalog?.emojiPacks || []).slice(0, 4);
  const skins = (catalog?.cardSkins || []).filter((s) => Number(s.priceGold || 0) > 0).slice(0, 4);
  const stickers = (stickerPacks || []).slice(0, 4);
  return h('section', { class: 'shop-section shop-mini-catalog' }, [
    h('div', { class: 'shop-section-head' }, [
      h('div', {}, [h('h2', {}, ['Emoji & Sticker paketlari']), h('p', {}, ['Mijoz nimani olayotganini rasmda ko‘radi.'])]),
      h('button', { onclick: () => { sfx.play('click'); TAB = 'stickers'; renderShop(root); } }, ['Barchasi']),
    ]),
    h('div', { class: 'shop-product-grid mini' }, [
      ...emoji.map((p) => tile({
        icon: p.icon || PACK_ICON[p.name] || ':)',
        title: p.name,
        rarity: p.premium ? 'premium' : p.rarity,
        badges: [OWNED_EMOJI_PACK_IDS.has(p.id) ? 'OLINGAN' : null, p.premium ? 'PREMIUM' : RARITY_LABEL[p.rarity] || p.rarity].filter(Boolean),
        price: OWNED_EMOJI_PACK_IDS.has(p.id) ? "O'yinda bor" : `GC ${fmt(p.priceGold || 0)}`,
        disabled: false,
        onClick: () => { TAB = 'stickers'; renderShop(root); },
      })),
      ...stickers.map((p) => tile({
        icon: stickerIcon(p),
        title: p.name,
        rarity: p.premium ? 'premium' : p.rarity,
        badges: [OWNED_STICKER_IDS.has(p.id) ? 'OLINGAN' : null, `${p.size || 12} dona`].filter(Boolean),
        price: OWNED_STICKER_IDS.has(p.id) ? "O'yinda bor" : `GC ${fmt(p.priceGold || 0)}`,
        disabled: false,
        stickerPreview: stickerPreview(p),
        onClick: () => { TAB = 'emoji'; renderShop(root); },
      })),
      ...skins.map((s) => tile({
        icon: 'A',
        title: s.name,
        rarity: s.premium ? 'premium' : s.rarity,
        badges: [s.premium ? 'PREMIUM' : RARITY_LABEL[s.rarity] || s.rarity].filter(Boolean),
        price: OWNED_SKIN_IDS.has(s.id) ? "Qo'yish" : `GC ${fmt(s.priceGold || 0)}`,
        disabled: false,
        cardPreview: s.id,
        onClick: () => { TAB = 'cards'; renderShop(root); },
      })),
    ]),
  ]);
}

function renderDonations(body, root, config, me) {
  const minCents = Math.max(50, Number(config?.minDonationUsdCents || 50));
  const presets = [minCents, 500, 1000, 2500, 5000].filter((v, i, arr) => v >= minCents && arr.indexOf(v) === i);
  body.appendChild(hero('Donat', 'Majburiy emas. Faqat loyihani rivojlantirish uchun ixtiyoriy yordam.', `Minimal $${money(minCents / 100)}`));
  body.appendChild(h('section', { class: 'shop-section donation-section' }, [
    h('div', { class: 'donation-hero-card' }, [
      h('div', {}, [
        h('small', {}, ['Durak Imperia']),
        h('h2', {}, ['Loyihani qo‘llab-quvvatlash']),
        h('p', {}, ['Donat real to‘lov orqali qilinadi, o‘yinda ustunlik bermaydi va majburiy emas.']),
      ]),
      h('div', { class: 'donation-medal' }, ['D']),
    ]),
    h('div', { class: 'donation-preset-grid' }, presets.map((amount) => h('button', {
      onclick: () => openShopCheckout(root, {
        type: 'donation',
        id: 'support',
        title: `Donat $${money(amount / 100)}`,
        subtitle: `${me.username || 'Player'} nomidan ixtiyoriy yordam`,
        price: `$${money(amount / 100)}`,
        amountUsdCents: amount,
      }),
    }, [`$${money(amount / 100)}`]))),
  ]));
}

function renderEmoji(body, root, packs, me, isPremium) {
  const premiumCount = packs.filter((p) => p.premium).length;
  body.appendChild(hero('Premium Emoji', `${premiumCount} ta maxsus premium pack. Barcha packlar Gold Coin bilan olinadi.`, `${fmt(me.gold_coins || 0)} GC mavjud`));
  body.appendChild(grid(packs, (p) => {
    const premiumLocked = p.premium && !isPremium;
    const owned = OWNED_EMOJI_PACK_IDS.has(p.id);
    const priceGold = Number(p.priceGold || 0);
    const disabled = premiumLocked || (!owned && Number(me.gold_coins || 0) < priceGold) || p.exclusive;
    return tile({
      icon: p.icon || PACK_ICON[p.name] || '☺',
      title: p.name,
      rarity: p.premium ? 'premium' : p.rarity,
      badges: [owned ? 'OLINGAN' : null, p.premium ? 'PREMIUM' : RARITY_LABEL[p.rarity] || p.rarity, p.exclusive ? '32 avlod' : null].filter(Boolean),
      price: owned ? "O'yinda bor" : p.exclusive ? 'Eksklyuziv' : `⚡ ${fmt(priceGold)} GC`,
      disabled,
      onClick: async () => {
        if (owned) return toast(`${p.name} allaqachon olingan. O'yin chatida ishlatishingiz mumkin.`, 'success');
        if (p.exclusive) return toast('Bu pack 32-avlod referal mukofoti', 'info');
        if (premiumLocked) {
          const plan = (SHOP_CACHE.premiumTiers || [])[0] || { id: 'premium_month', name: 'Premium 1 oy', days: 30, priceGoldCoins: 300 };
          return openPremiumCheckout(root, plan);
        }
        if (Number(me.gold_coins || 0) < priceGold) return openNeedGold(root, priceGold, 'Emoji olish uchun');
        await buyAndRefresh(root, () => api.buyPack(p.id), (r) => {
          state.user.gold_coins = r.goldCoins;
          return `${p.name} olindi`;
        });
      },
    });
  }));
}
function renderEmojiAndStickers(body, root, packs, stickerPacks, me, isPremium) {
  body.appendChild(renderEmojiStore(root, packs, me, isPremium));
  body.appendChild(renderEmojiStoreBenefits(root));
}

function renderEmojiStore(root, packs, me, isPremium) {
  const visible = (packs || []).slice(0, 25);
  return h('section', { class: 'emoji-pack-store' }, [
    h('div', { class: 'emoji-store-head' }, [
      h('div', {}, [
        h('small', {}, ['Premium emoji do‘koni']),
        h('h2', {}, ['Emoji & Sticker paketlari']),
        h('p', {}, ['Har bir pack ichidagi ko‘rinishlar oldindan ko‘rinadi. Xarid faqat Gold Coin orqali yechiladi.']),
      ]),
      h('div', { class: 'emoji-store-wallet' }, [
        h('b', {}, [`${fmt(me.gold_coins || 0)} GC`]),
        h('span', {}, ['55 GC = 1 USD']),
      ]),
    ]),
    h('div', { class: 'emoji-pack-grid' }, visible.map((p) => renderEmojiPackCard(root, p, me, isPremium))),
  ]);
}

function renderEmojiPackCard(root, p, me, isPremium) {
  const owned = OWNED_EMOJI_PACK_IDS.has(p.id);
  const priceGold = Number(p.priceGold || 0);
  const premiumLocked = p.premium && !isPremium;
  const canBuy = owned || (!premiumLocked && !p.exclusive && Number(me.gold_coins || 0) >= priceGold);
  const feature = (p.features || [p.rarity]).slice(0, 2).join(' • ');
  return h('button', {
    class: `emoji-pack-card rarity-${p.rarity || 'rare'}${owned ? ' owned' : ''}${canBuy ? '' : ' disabled'}`,
    onclick: async () => {
      sfx.play('click');
      if (owned) return toast(`${p.name} allaqachon olingan. O‘yinda ishlatishingiz mumkin.`, 'success');
      if (p.exclusive) return toast('Bu pack maxsus mukofot orqali ochiladi', 'info');
      if (premiumLocked) {
        const plan = (SHOP_CACHE.premiumTiers || [])[0] || { id: 'premium_month', name: 'Premium 1 oy', days: 30, priceGoldCoins: 300 };
        return openPremiumCheckout(root, plan);
      }
      if (Number(me.gold_coins || 0) < priceGold) return openNeedGold(root, priceGold, `${p.name} uchun Gold Coin`);
      await buyAndRefresh(root, () => api.buyPack(p.id), (r) => {
        state.user.gold_coins = r.goldCoins;
        return `${p.name} pack olindi`;
      });
    },
  }, [
    h('div', { class: 'emoji-pack-title' }, [p.name]),
    h('div', { class: 'emoji-preview-grid' }, emojiPreviewItems(p).map((glyph) => h('span', {}, [glyph]))),
    h('div', { class: 'emoji-pack-meta' }, [
      h('span', {}, [owned ? 'Olingan' : (feature || 'Yangi')]),
      h('b', {}, [owned ? "O'yinda bor" : `🟡 ${fmt(priceGold)}`]),
    ]),
  ]);
}

function renderEmojiStoreBenefits(root) {
  const items = [
    ['★', 'Eksklyuziv'],
    ['✦', 'Animatsiyali'],
    ['⚡', 'Ovoz effektli'],
    ['🎁', 'Doim yangilanadi'],
    ['🟡', '55 GC = 1 USD'],
  ];
  return h('section', { class: 'emoji-store-footer' }, [
    h('div', { class: 'emoji-feature-strip' }, items.map(([icon, label]) => h('span', {}, [h('b', {}, [icon]), label]))),
    h('button', { onclick: () => { sfx.play('click'); TAB = 'donations'; renderShop(root); } }, ['Donat qilish']),
  ]);
}

function emojiPreviewItems(pack) {
  const preview = Array.isArray(pack.preview) && pack.preview.length ? pack.preview : [pack.icon || '😀', '😂', '😍', '😎', '👍', '🔥', '🎉', '💎'];
  return Array.from({ length: 8 }, (_, i) => preview[i % preview.length]);
}

function renderCardSkins(body, root, skins, me, isPremium) {
  body.appendChild(hero('Karta Skinlari', 'Sotib olingan dizayn darhol kartalaringizga qo‘yiladi. Narxlar Gold Coin hisobidan yechiladi.', `${fmt(me.gold_coins || 0)} GC mavjud`));
  body.appendChild(grid(skins, (s) => {
    const premiumLocked = s.premium && !isPremium;
    const priceGold = Number(s.priceGold || 0);
    const free = priceGold === 0;
    const owned = free || OWNED_SKIN_IDS.has(s.id) || me.selected_skin === s.id;
    const selected = me.selected_skin === s.id || (!me.selected_skin && s.id === 'default');
    const disabled = premiumLocked || (!owned && Number(me.gold_coins || 0) < priceGold) || s.exclusive;
    return tile({
      icon: 'A',
      title: s.name,
      rarity: s.premium ? 'premium' : s.rarity,
      badges: [`${s.tier || ''}-daraja`, s.premium ? 'PREMIUM' : RARITY_LABEL[s.rarity] || s.rarity, s.exclusive ? '32 avlod' : null].filter(Boolean),
      price: selected ? "Qo'yilgan" : owned ? "Qo'yish" : s.exclusive ? 'Eksklyuziv' : free ? 'Bepul' : `⚡ ${fmt(priceGold)} GC`,
      disabled,
      cardPreview: s.id,
      onClick: async () => {
        if (selected) return toast(`${s.name} allaqachon qo'yilgan`, 'info');
        if (owned) {
          await buyAndRefresh(root, () => api.selectSkin(s.id), (r) => {
            state.user.selected_skin = r.selectedSkin;
            setPref('pref_card_shirt', true);
            return `${s.name} kartalarga qo'yildi`;
          });
          return;
        }
        if (s.exclusive) return toast('Bu skin 32-avlod referal mukofoti', 'info');
        if (premiumLocked) {
          const plan = (SHOP_CACHE.premiumTiers || [])[0] || { id: 'premium_month', name: 'Premium 1 oy', days: 30, priceGoldCoins: 300 };
          return openPremiumCheckout(root, plan);
        }
        if (Number(me.gold_coins || 0) < priceGold) return openNeedGold(root, priceGold, 'Karta skini olish uchun');
        await buyAndRefresh(root, () => api.buySkin(s.id), (r) => {
          state.user.gold_coins = r.goldCoins;
          state.user.selected_skin = r.selectedSkin || s.id;
          setPref('pref_card_shirt', true);
          return `${s.name} olindi va kartalarga qo'yildi`;
        });
      },
    });
  }));
}

function renderStickers(body, root, packs, me, isPremium) {
  body.appendChild(renderStickerPackStore(root, packs, me, isPremium));
}

function renderStickerPackStore(root, packs, me, isPremium) {
  const visible = normalizeList(packs).slice(0, 50);
  return h('section', { class: 'premium-sticker-store' }, [
    h('div', { class: 'premium-sticker-head' }, [
      h('div', {}, [
        h('small', {}, ['Premium sticker store']),
        h('h2', {}, ['Sticker to\'plamlari']),
        h('p', {}, ['Har bir pack ichida o‘z mavzusidagi katta sticker rasmlar bor.']),
      ]),
      h('div', { class: 'premium-sticker-wallet' }, [
        h('b', {}, [`${fmt(me.gold_coins || 0)} GC`]),
        h('span', {}, ['55 GC = 1 USD']),
      ]),
    ]),
    h('div', { class: 'premium-sticker-grid' }, visible.length
      ? visible.map((pack) => renderStickerPackCard(root, pack, me, isPremium))
      : [h('div', { class: 'shop-empty' }, ["Hozircha sticker pack yo'q"])]),
    renderStickerFeatureBar(),
  ]);
}

function renderStickerPackCard(root, pack, me, isPremium) {
  const priceGold = Number(pack.priceGold || 0);
  const premiumLocked = pack.premium && !isPremium;
  const notForSale = priceGold <= 0;
  const owned = Number(pack.owned || 0) > 0 || OWNED_STICKER_IDS.has(pack.id);
  const currentGold = Number(me.gold_coins || 0);
  const canBuy = !owned && !premiumLocked && !notForSale && currentGold >= priceGold;
  const unavailable = premiumLocked || notForSale || (!owned && currentGold < priceGold);
  const faces = stickerPackFaces(pack);
  return h('button', {
    class: `premium-sticker-pack-card rarity-${pack.rarity || 'common'}${owned ? ' owned' : ''}${unavailable ? ' disabled' : ''}`,
    style: stickerPackStyle(pack),
    type: 'button',
    onclick: async () => {
      sfx.play('click');
      if (owned) return toast(`${pack.name} sizda bor. O'yinda sticker tugmasidan ishlating.`, 'success');
      if (notForSale) return toast(`${pack.name} maxsus mukofot orqali ochiladi`, 'info');
      if (premiumLocked) {
        const plan = (SHOP_CACHE.premiumTiers || [])[0] || { id: 'premium_month', name: 'Premium 1 oy', days: 30, priceUsd: null };
        return openPremiumCheckout(root, plan);
      }
      if (!canBuy) return openNeedGold(root, priceGold, `${pack.name} sticker packi uchun`);
      await buyAndRefresh(root, () => api.stickerBuy(pack.id), (r) => {
        state.user.gold_coins = r.goldCoins;
        return `${pack.name} sticker pack olindi`;
      });
    },
  }, [
    h('div', { class: 'premium-sticker-card-head' }, [
      h('span', { class: 'premium-sticker-tag' }, [owned ? 'OLINGAN' : (pack.tag || 'PACK')]),
      h('strong', { class: 'premium-sticker-title' }, [String(pack.name || 'Sticker').toUpperCase()]),
      h('span', { class: 'premium-sticker-tag right' }, [`${pack.size || faces.length || 8} dona`]),
    ]),
    h('div', { class: 'premium-sticker-face-grid' }, faces.map((face, index) => renderStickerFace(face, index))),
    h('div', { class: `premium-sticker-price${owned ? ' owned' : ''}` }, [
      owned ? "O'yinda bor" : notForSale ? 'Mukofot' : `GC ${fmt(priceGold)}`,
    ]),
  ]);
}

function renderStickerFace(sticker, index) {
  const img = typeof sticker === 'string' ? sticker : sticker?.img;
  return h('span', {
    class: 'premium-sticker-face',
    'data-slot': String(index + 1),
  }, [
    h('img', {
      src: img || '',
      alt: sticker?.name || '',
      loading: 'lazy',
      onerror: (e) => { e.currentTarget.style.visibility = 'hidden'; },
    }),
  ]);
}

function stickerPackFaces(pack) {
  const source = Array.isArray(pack.preview) && pack.preview.length ? pack.preview : (Array.isArray(pack.stickers) ? pack.stickers : []);
  const faces = source.filter(Boolean).slice(0, 8);
  if (!faces.length) return faces;
  while (faces.length < 8) {
    const last = faces[faces.length - 1];
    faces.push(typeof last === 'string'
      ? last
      : { ...last, name: last?.name || `${pack.name || 'Sticker'} ${faces.length + 1}` });
  }
  return faces;
}

function stickerPackStyle(pack) {
  const color = safeCssValue(pack.themeColor, '#e1b14c');
  const glow = safeCssValue(pack.themeGlow, 'rgba(225,177,76,.36)');
  const panel = safeCssValue(pack.panelColor, 'rgba(17,12,26,.68)');
  return `--sticker-pack-color:${color};--sticker-pack-glow:${glow};--sticker-pack-panel:${panel}`;
}

function safeCssValue(value, fallback) {
  const s = String(value || '').trim();
  return /^[#(),.%\w\s-]+$/.test(s) ? s : fallback;
}

function renderStickerFeatureBar() {
  const items = [
    ['*', 'EKSKLYUZIV'],
    ['+', 'ANIMATSIYALI'],
    ['SFX', 'OVOZ EFFEKTLI'],
    ['NEW', 'DOIM YANGILANADI'],
    ['GC', '55 GC = 1 USD'],
  ];
  return h('div', { class: 'premium-sticker-feature-bar' }, items.map(([icon, label]) => h('span', {}, [
    h('b', {}, [icon]),
    label,
  ])));
}


function renderProfileFrames(body, root, frames, me) {
  body.appendChild(hero('Profil bezaklari', "Avatar atrofiga qo'yiladigan premium bezaklar. Sotib olgandan keyin profilga avtomatik qo'yiladi.", `${fmt(me.gold_coins || 0)} GC mavjud`));
  const rows = [
    h('button', {
      class: `profile-frame-shop-row owned ${!me.selected_avatar_frame ? 'selected' : ''}`,
      onclick: async () => {
        await buyAndRefresh(root, () => api.selectProfileFrame('none'), () => 'Profil bezagi olib tashlandi');
        state.user.selected_avatar_frame = null;
      },
    }, [
      h('span', { class: 'profile-frame-preview frame-none' }, [h('i', {}, ['O'])]),
      h('strong', {}, ['Bezaksiz']),
      h('b', {}, [!me.selected_avatar_frame ? "Qo'yilgan" : "Qo'yish"]),
      h('em', {}, [!me.selected_avatar_frame ? 'OK' : '+']),
    ]),
  ];
  rows.push(...frames.map((f) => {
    const owned = OWNED_FRAME_IDS.has(f.id) || me.selected_avatar_frame === f.id;
    const selected = me.selected_avatar_frame === f.id;
    const disabled = !owned && Number(me.gold_coins || 0) < Number(f.priceGold || 0);
    return h('button', {
      class: `profile-frame-shop-row rarity-${f.rarity || 'common'} ${owned ? 'owned' : ""} ${selected ? 'selected' : ""}`,
      disabled,
      onclick: async () => {
        if (owned) {
          await buyAndRefresh(root, () => api.selectProfileFrame(f.id), () => `${f.name} profilga qo'yildi`);
          state.user.selected_avatar_frame = f.id;
          return;
        }
        if (disabled) return openNeedGold(root, Number(f.priceGold || 0), 'Profil bezagi olish uchun');
        await buyAndRefresh(root, () => api.buyProfileFrame(f.id), (r) => {
          state.user.gold_coins = r.goldCoins;
          state.user.selected_avatar_frame = r.selectedAvatarFrame;
          return `${f.name} sotib olindi va profilga qo'yildi`;
        });
      },
    }, [
      h('span', { class: `profile-frame-preview frame-${f.id}` }, [
        h('i', {}, [f.icon || '\u25CB']),
      ]),
      h('strong', {}, [f.name]),
      h('b', {}, [owned ? selected ? "Qo'yilgan" : "Qo'yish" : fmt(f.priceGold || 0)]),
      h('em', {}, [owned ? 'OK' : '+']),
    ]);
  }));
  body.appendChild(h('div', { class: 'profile-frame-shop-list' }, rows));
}

function hero(title, subtitle, tag) {
  return h('section', { class: 'shop-hero' }, [
    h('div', {}, [
      h('p', {}, [tag]),
      h('h1', {}, [title]),
      h('span', {}, [subtitle]),
    ]),
  ]);
}

function row({ icon, title, subtitle, meta, cta, disabled, onClick }) {
  return h('div', { class: `shop-row${disabled ? ' disabled' : ''}` }, [
    h('div', { class: 'shop-row-icon' }, [icon]),
    h('div', { class: 'shop-row-main' }, [
      h('strong', {}, [title]),
      h('span', {}, [subtitle]),
    ]),
    h('div', { class: 'shop-row-side' }, [
      h('b', {}, [meta]),
      h('button', { class: 'shop-buy', onclick: onClick }, [cta]),
    ]),
  ]);
}

function grid(items, render) {
  const el = h('div', { class: 'shop-product-grid' });
  for (const item of items) el.appendChild(render(item));
  if (!items.length) el.appendChild(h('div', { class: 'shop-empty' }, ['Hozircha mahsulot yo‘q']));
  return el;
}

function tile({ icon, title, rarity, badges, price, disabled, onClick, cardPreview, stickerPreview }) {
  const safeSkinClass = cardPreview ? String(cardPreview).replace(/[^a-z0-9_-]/gi, '-') : '';
  const premiumClassic = cardPreview === 'classic_gold';
  const previewStyle = cardPreview ? cardSkinStyle(cardPreview) : '';
  const hasCardArt = previewStyle.includes('url("');
  const preview = cardPreview
    ? h('div', {
      class: `shop-card-preview skin-dynamic ${cardSkinClass(cardPreview)}`,
      style: previewStyle,
      'data-skin': cardPreview,
      'data-has-art': hasCardArt ? '1' : '0',
      'data-premium-classic': cardPreview === 'classic_gold' ? '1' : '0',
    }, [
      h('span', { class: 'shop-card-corner top' }, ['A', h('small', {}, ['\u2660'])]),
      h('span', { class: 'shop-card-pip' }, [premiumClassic ? '\u25C7' : '\u2660']),
      h('span', { class: 'shop-card-corner bottom' }, ['A', h('small', {}, ['\u2660'])]),
    ])
    : stickerPreview
      ? h('div', { class: `shop-sticker-preview theme-${stickerPreview.theme}` }, [
        h('div', { class: 'sticker-cover-main' }, [
          stickerPreview.coverImg
            ? h('img', {
              src: stickerPreview.coverImg,
              alt: title || 'Sticker',
              loading: 'lazy',
              onerror: (e) => { e.currentTarget.style.display = 'none'; },
            })
            : stickerPreview.cover,
        ]),
        h('div', { class: 'sticker-cover-strip' }, stickerPreview.items.map((item) => h('span', { class: 'sticker-mini' }, [
          h('img', {
            src: item.img,
            alt: item.label,
            onerror: (e) => { e.currentTarget.style.display = 'none'; },
          }),
          h('b', {}, [item.label]),
        ]))),
      ])
      : h('div', { class: 'shop-product-icon' }, [icon]);
  return h('button', {
    class: `shop-product rarity-${rarity || 'common'}${cardPreview ? ` card-skin-tile card-skin-tile-${safeSkinClass}` : ''}${stickerPreview ? ' sticker-product' : ''}${disabled ? ' disabled' : ''}`,
    onclick: onClick,
  }, [
    preview,
    h('strong', {}, [title]),
    h('div', { class: 'shop-badges' }, badges.map((b) => h('span', {}, [b]))),
    h('div', { class: 'shop-product-price' }, [price]),
  ]);
}

async function buyAndRefresh(root, action, messageFromResponse) {
  sfx.play('click');
  try {
    const result = await action();
    if (!state.user) state.user = {};
    const msg = messageFromResponse(result);
    sfx.play('coin');
    toast(`✓ ${msg}`, 'success');
    await renderShop(root);
  } catch (e) {
    toast(e.message || 'Xarid bajarilmadi', 'error');
  }
}

function fmt(n) {
  return Number(n || 0).toLocaleString();
}

function money(n) {
  if (n === null || n === undefined || n === '') return 'keyin belgilanadi';
  return Number(n || 0).toFixed(Number(n) % 1 === 0 ? 0 : 2);
}

function priceUsdText(value) {
  return value === null || value === undefined || value === ''
    ? 'Narx keyin belgilanadi'
    : `$${money(value)}`;
}

function premiumUntilText(value) {
  if (!value) return 'Premium yo‘q';
  const d = new Date(value);
  if (Number.isNaN(d.getTime()) || d <= new Date()) return 'Premium yo‘q';
  return `${d.toLocaleDateString()} gacha`;
}

function stickerPreview(pack) {
  const themes = {
    pack_basic:     { theme: 'basic', cover: '\u2726', items: ['A', '\u2665', '\u2663', '\u2605'] },
    pack_uzbek:     { theme: 'uzbek', cover: '\u25C8', items: ['UZ', '\u25C6', '\u25C7', '\u2738'] },
    pack_emotion:   { theme: 'emotion', cover: '\u263A', items: ['\u263A', '\u263B', '!', '?'] },
    pack_animals:   { theme: 'animals', cover: '\u2724', items: ['PAW', '\u2605', '\u25CF', '\u2724'] },
    pack_funny:     { theme: 'funny', cover: 'HA', items: ['HA', 'LOL', ':)', ':D'] },
    pack_meme:      { theme: 'meme', cover: 'MEME', items: ['OK', 'NO', 'GG', 'WOW'] },
    pack_gangster:  { theme: 'card', cover: '\u2660', items: ['A', 'K', 'Q', 'J'] },
    pack_royal:     { theme: 'royal', cover: '\u265B', items: ['\u265B', '\u265A', '\u265C', '\u2726'] },
    pack_neon:      { theme: 'neon', cover: '\u25C6', items: ['\u25C6', '\u25C7', '\u25B2', '\u25CF'] },
    pack_dragon:    { theme: 'dragon', cover: 'DR', items: ['DR', 'FIRE', '\u2726', '\u25B2'] },
    pack_celestial: { theme: 'celestial', cover: '\u2605', items: ['\u2605', '\u263E', '\u2609', '\u2726'] },
    pack_elon:      { theme: 'elon', cover: '\u25B2', items: ['GO', 'MARS', '\u2605', '\u25B2'] },
  };
  const meta = themes[pack.id] || { theme: 'basic', cover: stickerIcon(pack), items: [stickerIcon(pack), '\u2726', '\u25C6', '\u2605'] };
  const preview = Array.isArray(pack.preview) && pack.preview.length ? pack.preview : (pack.stickers || []).slice(0, 4);
  return {
    ...meta,
    coverImg: preview[0]?.img || '',
    items: meta.items.map((label, idx) => ({
      label,
      img: preview[idx]?.img || `/stickers/${pack.id}/${idx + 1}.svg`,
    })),
  };
}

function stickerIcon(pack) {
  if (pack.id?.includes('elon')) return '🚀';
  if (pack.id?.includes('royal')) return '👑';
  if (pack.id?.includes('dragon')) return '🐉';
  if (pack.id?.includes('neon')) return '◆';
  if (pack.id?.includes('animal')) return '🐯';
  return '✦';
}
