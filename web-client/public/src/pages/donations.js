// Donations — REAL Stripe payments (PRO v5)
// • Click "Donat" → Stripe Checkout opens → after success webhook records the donation.
// • Top donors list loads from /api/donations (real only, fake removed).
// • Success / cancel banners show if URL contains ?donation=success/cancel
import { h } from '../ui.js';
import { api } from '../api.js';
import { state, toast } from '../state.js';
import { navigate } from '../router.js';
import { sfx } from '../sfx.js?v=164-i18n-audio';
import { attachGoldScrollIndicator } from '../scrollIndicator.js';

const PRESET_AMOUNTS = [1, 5, 10, 25, 50, 100];

export async function renderDonations(root, params = {}) {
  root.innerHTML = '';
  const wrap = h('div', { class: 'screen bg-lobby donations-screen' });

  wrap.appendChild(h('div', { class: 'lobby-topbar' }, [
    h('button', { class: 'btn-icon', onclick: () => { sfx.play('click'); navigate('home'); } }, ['◀']),
    h('div', { class: 'title' }, ['❤️ Donat']),
    h('div', { class: 'coins' }, [`$${(state.user?.coins || 0).toLocaleString()}`]),
  ]));

  const scroll = h('div', { class: 'scroll donation-page-scroll', style: 'padding:14px' });
  wrap.appendChild(scroll);
  root.appendChild(wrap);
  const detachScroll = attachGoldScrollIndicator(scroll, {
    className: 'donation-gold-scroll-track',
    top: 86,
    bottom: 14,
  });

  let cfg = { minDonationUsd: 0.5 };
  try { cfg = await api.donationsConfig(); } catch (_) {}

  // ── Success / cancel banner ───────────────────────────────────────
  const paymentNotice = await resolveDonationCheckout(params);
  if (paymentNotice) {
    scroll.appendChild(h('div', { class: `payment-banner ${paymentNotice.type}` }, [paymentNotice.text]));
  }
  const donationStatus = params.donation || params.status || params.payment;
  if (donationStatus === 'success' && !paymentNotice) {
    scroll.appendChild(h('div', { class: 'payment-banner success' }, [
      '✓ Rahmat! To\'lov muvaffaqiyatli amalga oshirildi. Sizning ismingiz tez orada ro\'yxatda paydo bo\'ladi.',
    ]));
  } else if (donationStatus === 'cancelled' || donationStatus === 'cancel') {
    scroll.appendChild(h('div', { class: 'payment-banner cancel' }, [
      '✗ To\'lov bekor qilindi. Qachondir qaytib keling!',
    ]));
  }

  // ── Intro / Donate Form ──────────────────────────────────────────
  let selectedAmount = 5;
  let customMessage = '';

  const intro = h('div', { class: 'section-card' }, [
    h('h3', { style: 'display:flex;align-items:center;gap:10px' }, ['❤️ Loyihani qo\'llab-quvvatlash']),
    h('div', { class: 'muted', style: 'font-size:13px;line-height:1.6;margin-bottom:14px' }, [
      `Minimum: $${cfg.minDonationUsd.toFixed(2)}. Sizning hissangiz loyihaning rivojlanishiga sarflanadi: server, hosting, yangi xususiyatlar va o'yin balansini yaxshilash uchun.`,
    ]),
    h('div', { style: 'font-size:11px;color:var(--rc-gold);letter-spacing:.1em;margin-bottom:8px;font-weight:800' }, ['MIQDOR (USD)']),
    // Preset amounts grid
    h('div', { id: 'preset-grid', style: 'display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:14px' },
      PRESET_AMOUNTS.map((amt) => {
        const btn = h('button', {
          class: 'preset-amt',
          'data-amt': String(amt),
          style: `padding:14px 6px;border-radius:10px;font-weight:900;font-size:16px;cursor:pointer;
                  background:${amt === selectedAmount ? 'linear-gradient(180deg,#f5df9b,#9f6a2d)' : 'linear-gradient(180deg,#5e3a22,#28140d)'};
                  color:${amt === selectedAmount ? '#2a1308' : 'var(--rc-text-bright)'};
                  border:2px solid rgba(216,179,95,.5);`,
        }, [`$${amt}`]);
        btn.addEventListener('click', () => {
          selectedAmount = amt;
          // re-render preset visuals
          intro.querySelectorAll('.preset-amt').forEach((b) => {
            const v = Number(b.dataset.amt);
            b.style.background = v === selectedAmount
              ? 'linear-gradient(180deg,#f5df9b,#9f6a2d)'
              : 'linear-gradient(180deg,#5e3a22,#28140d)';
            b.style.color = v === selectedAmount ? '#2a1308' : 'var(--rc-text-bright)';
          });
          intro.querySelector('[data-key=custom]').value = '';
          sfx.play('click');
        });
        return btn;
      })
    ),
    h('div', { style: 'font-size:11px;color:var(--rc-gold);letter-spacing:.1em;margin-bottom:6px;font-weight:800' }, ['YOKI O\'Z MIQDORINGIZ']),
    h('input', {
      type: 'number',
      min: String(cfg.minDonationUsd),
      step: '0.5',
      'data-key': 'custom',
      placeholder: `Boshqa miqdor (min $${cfg.minDonationUsd})`,
      style: 'font-size:15px;margin-bottom:12px',
      oninput: (e) => {
        const v = Number(e.target.value);
        if (v > 0) {
          selectedAmount = v;
          intro.querySelectorAll('.preset-amt').forEach((b) => {
            b.style.background = 'linear-gradient(180deg,#5e3a22,#28140d)';
            b.style.color = 'var(--rc-text-bright)';
          });
        }
      },
    }),
    h('div', { style: 'font-size:11px;color:var(--rc-gold);letter-spacing:.1em;margin-bottom:6px;font-weight:800' }, ['XABAR (ixtiyoriy)']),
    h('input', {
      type: 'text',
      maxlength: '120',
      'data-key': 'message',
      placeholder: 'Sizning xabaringiz (top donatorlar ro\'yxatida ko\'rinadi)',
      style: 'font-size:14px;margin-bottom:14px',
      oninput: (e) => { customMessage = e.target.value; },
    }),
    h('button', {
      class: 'btn-big red',
      style: 'min-height:54px;font-size:17px',
      onclick: async () => {
        sfx.play('click');
        const usd = selectedAmount;
        if (!(usd > 0)) return toast('Miqdor kiritilmagan', 'error');
        if (usd < cfg.minDonationUsd) return toast(`Minimum $${cfg.minDonationUsd}`, 'error');
        const cents = Math.round(usd * 100);
        try {
          const r = await api.stripeCheckout('donation', '', {
            amountUsdCents: cents,
            message: customMessage || undefined,
            successPath: '/#/donations?donation=success',
            cancelPath: '/#/donations?donation=cancel',
          });
          if (r?.url) {
            window.location.href = r.url;
          } else {
            toast('To\'lov tizimi sozlanmagan. Iltimos, admin bilan bog\'laning.', 'error');
          }
        } catch (e) {
          toast(e.message || 'Xatolik yuz berdi', 'error');
        }
      },
    }, [`❤️  STRIPE ORQALI DONAT $${selectedAmount}`]),
    h('div', { class: 'muted text-c', style: 'margin-top:10px;font-size:11px' }, [
      '🔒 To\'lov xavfsiz Stripe orqali. Karta ma\'lumotlari Stripe serveriga yuboriladi, biz ko\'rmaymiz.',
    ]),
  ]);
  scroll.appendChild(intro);

  // Update button text when amount changes
  const updateBtnText = () => {
    const btn = intro.querySelector('.btn-big.red');
    if (btn) btn.textContent = `❤️  STRIPE ORQALI DONAT $${selectedAmount}`;
  };
  intro.querySelectorAll('.preset-amt').forEach((b) => b.addEventListener('click', updateBtnText));
  intro.querySelector('[data-key=custom]').addEventListener('input', updateBtnText);

  // ── Donors leaderboard (REAL only) ───────────────────────────────
  const board = h('div', { class: 'section-card' });
  board.appendChild(h('h3', {}, ['🏆 Top donatorlar']));
  const listBox = h('div', {});
  board.appendChild(listBox);
  scroll.appendChild(board);

  await renderTopDonors(listBox);
  return detachScroll;
}

async function renderTopDonors(container) {
  try {
    const donors = await api.donationsList(100);
    container.innerHTML = '';

    if (!donors?.length) {
      container.appendChild(h('div', { class: 'donors-empty muted text-c' }, [
        h('span', { class: 'donors-empty-icon' }, ['🌟']),
        h('p', {}, ['Hozircha donatorlar yo\'q']),
        h('p', { class: 'donors-empty-sub' }, ['Birinchi donator bo\'ling va doim yodda qolasiz!']),
      ]));
      return;
    }

    const list = h('ol', { class: 'donors-list' });
    donors.slice(0, 100).forEach((donor, i) => {
      const rank = donor.rank || i + 1;
      const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `#${rank}`;
      const cents = Number(donor.amountUsdCents ?? donor.amount_usd_cents ?? Math.round(Number(donor.amountUsd || 0) * 100));
      list.appendChild(h('li', { class: `donor-item ${rank <= 3 ? 'top3' : ''}` }, [
        h('span', { class: 'donor-rank' }, [medal]),
        h('div', { class: 'donor-info' }, [
          h('strong', { class: 'donor-name' }, [donor.name || donor.display_name || 'Anonim']),
          donor.message ? h('p', { class: 'donor-message' }, [`"${String(donor.message).slice(0, 80)}"`]) : null,
        ].filter(Boolean)),
        h('span', { class: 'donor-amount' }, [`$${(cents / 100).toFixed(2)}`]),
      ]));
    });
    container.appendChild(list);
  } catch (e) {
    container.innerHTML = '';
    container.appendChild(h('p', { class: 'donors-error' }, [e.message || "Ro'yxat yuklanmadi"]));
  }
}

async function resolveDonationCheckout(params = {}) {
  const payment = String(params.payment || params.donation || params.status || '').toLowerCase();
  const sessionId = String(params.session_id || params.sessionId || '').trim();
  if (payment === 'cancel' || payment === 'cancelled') {
    return { type: 'cancel', text: "To'lov bekor qilindi. Pul yechilmadi." };
  }
  if (payment !== 'success' || !sessionId) return null;
  const key = `durak.stripe.fulfilled.${sessionId}`;
  try {
    const result = await api.fulfillStripeCheckout(sessionId);
    const duplicate = !!result?.duplicate || sessionStorage.getItem(key) === '1';
    sessionStorage.setItem(key, '1');
    return {
      type: 'success',
      text: duplicate ? "Bu donat oldin ro'yxatga olingan." : "Rahmat! Donatingiz tasdiqlandi va ro'yxatga qo'shildi.",
    };
  } catch (e) {
    if (sessionStorage.getItem(key) === '1') {
      return { type: 'success', text: "Bu donat oldin tasdiqlangan." };
    }
    return { type: 'error', text: e.message || "To'lovni tasdiqlashda xatolik bo'ldi." };
  }
}
