// Feature 24: in-game AI helper.
// The authoritative daily limit is enforced by the backend (/api/ai/*).
// This client module only answers allowed game questions and streams text to the UI.

const WEBLLM_MODEL_ID = 'SmolLM2-360M-Instruct-q4f16_1-MLC';
const WEBLLM_CDN = 'https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.73/lib/index.min.js';
const FREE_DAILY_LIMIT = 30;

const ALLOWED_TOPICS = [
  'Durak rules and strategy',
  'Gold Coin, Premium, card skins, stickers and shop items',
  'Premium vs permanent ownership',
  'Collection gifting',
  'Referral chain: direct 5 dollars, downstream 1 dollar',
  'Level/rank progress through play',
  'Optional donations',
  'Tournament limits, history and broadcast',
  'Daily baraban spin',
];

const SYSTEM_PROMPT = `You are Imperia AI, the in-game assistant for Durak Imperia.
Answer in the same language the user used whenever possible.
Keep replies short, helpful, and only about these allowed topics:
${ALLOWED_TOPICS.map((t) => `- ${t}`).join('\n')}

Never answer about admin panel, bot lists, owner identity, cheat bots, server internals, exploit methods, or hidden baraban odds.
If the user asks a blocked topic, say that you cannot help with that topic and invite them to ask about rules, shop, premium, tournament or baraban.
Do not invent Premium USD prices; say that final Premium prices are set in the store when approved.`;

const BLOCKED_PATTERNS = [
  /admin|panel|server|backend|database|sql/i,
  /bot.*(list|ro.yxat|список)|cheat|hack|exploit|cheater/i,
  /ehtimollik.*sir|sir.*ehtimollik|hidden.*odds|secret.*probability/i,
  /owner|egasi|developer|ishlab.*chiqar/i,
  /админ|сервер|база|чит|взлом|разработчик|владелец/i,
];

const INTENT_RULES = [
  {
    keys: [
      /premi?u?m|premum|primum|obuna|vip|cheksiz/i,
      /(premium|premum).*(ol|sotib|qanday|kerak|narx|qaer|qayer|do.?kon)/i,
      /(ol|sotib|qanday).*(premium|premum|obuna)/i,
    ],
    uz: "Premium olish uchun asosiy ekrandan Do'kon bo'limiga kiring, Premium tabini oching va kerakli muddatni tanlang. Premium AI so'rovlarini cheksiz qiladi, ovozli chat limitini kengaytiradi va ayrim premium bezaklarni ochadi. Agar narx ko'rinmasa, Play Market billing hali tasdiqlanmagan; do'kondagi ko'rsatmaga amal qiling.",
    ru: "Чтобы купить Premium, откройте Магазин на главном экране, перейдите во вкладку Premium и выберите срок. Premium дает безлимитные вопросы AI, расширяет голосовой чат и открывает часть премиум-украшений. Если цена не отображается, Play Market billing еще не подтвержден; следуйте подсказке в магазине.",
    en: "To get Premium, open Shop from the home screen, choose the Premium tab, and select a duration. Premium gives unlimited AI questions, expanded voice chat, and selected premium cosmetics. If prices are not shown yet, Play Market billing is not approved; follow the store message.",
  },
  {
    keys: [/gold|coin|gc|tanga|dollar|pul|sotib.*ol|do.?kon|shop|magazin|магазин/i],
    uz: "Do'konda Gold Coin, Dollar, Premium, emoji, karta va stiker bo'limlari bor. Kerakli bo'limni oching, mahsulotni tanlang va tasdiqlang. Sotib olingan bezaklar profil yoki o'yin ichida ishlatiladi, Dollar esa faqat o'yin ichidagi virtual balans.",
    ru: "В магазине есть разделы Gold Coin, Dollar, Premium, emoji, карты и стикеры. Откройте нужный раздел, выберите товар и подтвердите. Купленные украшения используются в профиле или игре, Dollar - только виртуальный игровой баланс.",
    en: "The shop has Gold Coin, Dollar, Premium, emoji, card, and sticker sections. Open the section you need, select an item, and confirm. Bought cosmetics are used in profile or gameplay; Dollar is only virtual in-game balance.",
  },
  {
    keys: [/nima.*qil|qanday.*yur|qaysi.*karta|maslahat|yordam|yutish|strateg|hint|advice/i],
    uz: "Hozirgi yurish bo'yicha so'rasangiz, men ko'rinib turgan kartalarga qarab maslahat beraman: qaysi kartani tashlash, qaysi karta bilan urish yoki qachon olish xavfsizroq. Raqibning yopiq kartalarini bilmayman, faqat stol va sizdagi kartalarga qarab aytaman.",
    ru: "Если спросите про текущий ход, я дам совет по видимым картам: какую карту сыграть, чем отбиться или когда безопаснее взять. Закрытые карты соперника я не знаю, поэтому советую только по столу и вашим картам.",
    en: "Ask about the current move and I will advise from visible cards: what to play, what to beat with, or when taking is safer. I do not know hidden opponent cards, so advice is based only on the table and your hand.",
  },
];

const RULES = [
  {
    keys: [/qoida|qanday.*o.yn|rules|how.*play|правил|как.*играть/i],
    uz: "Durakda hujumchi karta tashlaydi, himoyachi esa shu suitdagi kattaroq karta yoki kozir bilan uradi. Ura olmasa, stol kartalarini oladi. Maqsad: qo'ldagi kartalarni birinchi tugatish va oxirida Durak bo'lib qolmaslik.",
    ru: "В Дураке атакующий кладет карту, защитник бьет старшей картой той же масти или козырем. Если отбиться не может, забирает карты со стола. Цель - первым избавиться от карт и не остаться Дураком.",
    en: "In Durak, the attacker plays a card and the defender beats it with a higher card of the same suit or with trump. If the defender cannot beat it, they take the table cards. The goal is to empty your hand and avoid being the last player with cards.",
  },
  {
    keys: [/strateg|maslahat|совет|стратег|tip|hint|usul/i],
    uz: "Maslahat: kichik kartalarni ertaroq chiqaring, kozirlarni oxirgi himoya uchun saqlang, raqib nechta karta olganini kuzating. Raqib ko'p karta olsa, keyingi hujumlarda bosimni oshirish mumkin.",
    ru: "Совет: сначала избавляйтесь от мелких карт, козыри берегите для важной защиты, следите сколько карт берет соперник. Если соперник набрал много карт, можно усиливать давление.",
    en: "Tip: get rid of low cards early, save trumps for important defense, and track how many cards your opponent takes. If they pick up many cards, increase pressure on later attacks.",
  },
  {
    keys: [/premium|obuna|subscribe|vip|подписк/i],
    uz: "Premium qo'shimcha qulayliklar beradi: ovozli chat limitlari kengayadi, AI yordamchi cheksiz bo'ladi va ayrim kosmetik imkoniyatlar ochiladi. Yakuniy Premium narxlari Play Market do'konida tasdiqlangandan keyin ko'rsatiladi.",
    ru: "Premium дает дополнительные удобства: больше возможностей голосового чата, безлимитный AI-помощник и часть косметики. Финальные цены Premium показываются в магазине после утверждения.",
    en: "Premium adds convenience: expanded voice chat, unlimited AI helper use, and selected cosmetic access. Final Premium prices are shown in the store after approval.",
  },
  {
    keys: [/skin|karta.*dizayn|card.*skin|стикер|stiker|emoji|эмод/i],
    uz: "Skin, karta ko'ylagi, stiker va emoji do'kondan Gold Coin yoki Premium shartlari bilan olinadi. Sotib olingan kolleksiya inventoryda saqlanadi va ortiqcha kolleksiyalarni sovg'a qilish mumkin.",
    ru: "Скины, рубашки карт, стикеры и эмодзи покупаются в магазине за Gold Coin или по условиям Premium. Купленная коллекция хранится в инвентаре, лишние предметы можно дарить.",
    en: "Skins, card backs, stickers, and emoji are bought in the shop with Gold Coin or Premium access. Owned collection items stay in inventory, and duplicates can be gifted.",
  },
  {
    keys: [/referal|taklif|invite|zanjir|реферал|приглас/i],
    uz: "Referal tizimida bevosita taklif qilingan do'st uchun 5$, 2-32 zanjir darajalari uchun 1$ bonus bor. Bonuslar o'yin ichidagi virtual dollar bo'lib, real pul tikish emas.",
    ru: "В реферальной системе прямой друг дает 5$, уровни цепочки 2-32 дают по 1$. Это внутриигровые виртуальные доллары, не ставка реальными деньгами.",
    en: "The referral chain gives 5 virtual dollars for a direct invite and 1 virtual dollar for downstream levels 2-32. These are in-game dollars, not real-money betting.",
  },
  {
    keys: [/baraban|spin|aylantir|wheel|барабан|рулет/i],
    uz: "Baraban 10 ta o'yindan keyin ochiladi va har 24 soatda 1 marta bepul aylantiriladi. Sovrinlar: virtual dollar, Gold Coin, stiker, karta, turnir chiptasi yoki jackpot.",
    ru: "Барабан открывается после 10 игр и дает 1 бесплатное вращение каждые 24 часа. Призы: виртуальные доллары, Gold Coin, стикер, карта, турнирный билет или jackpot.",
    en: "The baraban unlocks after 10 games and gives one free spin every 24 hours. Prizes include virtual dollars, Gold Coin, stickers, cards, tournament tickets, or jackpot.",
  },
  {
    keys: [/turnir|tournament|chipta|ticket|турнир|билет/i],
    uz: "Turnirga 35 Gold Coin yoki 1 ta turnir chiptasi bilan kiriladi. 32 ishtirokchi qolganda bracket va jonli translyatsiya ochiladi; har bir o'yinda tomoshabinlar soni ko'rinadi.",
    ru: "В турнир можно войти за 35 Gold Coin или 1 турнирный билет. Когда остается 32 участника, открываются bracket и live-трансляция; у каждого матча виден счетчик зрителей.",
    en: "Tournament entry costs 35 Gold Coin or one tournament ticket. When 32 players remain, the bracket and live broadcast open, with viewer counts shown per match.",
  },
  {
    keys: [/donat|donate|support|xayriy|пожертв/i],
    uz: "Donat majburiy emas. U faqat loyihani rivojlantirishga yordam beradi va o'yinda real pul tikish elementini yaratmaydi.",
    ru: "Донат не обязателен. Он только помогает развитию проекта и не создает ставок реальными деньгами.",
    en: "Donations are optional. They support development and do not create any real-money betting element.",
  },
  {
    keys: [/salom|hello|hi\b|assalom|привет/i],
    uz: "Assalomu alaykum! Men Imperia AI yordamchisiman. Durak qoidalari, strategiya, do'kon, Premium, turnir, referal yoki baraban haqida so'rashingiz mumkin.",
    ru: "Привет! Я Imperia AI. Могу помочь с правилами Дурака, стратегией, магазином, Premium, турнирами, рефералами и барабаном.",
    en: "Hello! I am Imperia AI. You can ask me about Durak rules, strategy, the shop, Premium, tournaments, referrals, or the baraban.",
  },
];

let _engineMode = null;
let _webllmEngine = null;
let _initPromise = null;

function languageOf(text) {
  if (/[а-яё]/i.test(text)) return 'ru';
  if (/\b(the|how|what|premium|shop|tournament|hello|rules)\b/i.test(text)) return 'en';
  return 'uz';
}

function blockedReply(lang) {
  if (lang === 'ru') return 'Извините, по этой теме я не помогаю. Спросите о правилах, магазине, Premium, турнирах или барабане.';
  if (lang === 'en') return 'Sorry, I cannot help with that topic. Ask about rules, shop, Premium, tournaments, or baraban.';
  return "Kechirasiz, bu mavzu bo'yicha yordam bera olmayman. Qoidalar, do'kon, Premium, turnir yoki baraban haqida so'rang.";
}

function defaultReply(lang) {
  if (lang === 'ru') return 'Я могу помочь с правилами Дурака, стратегией, магазином, Premium, турнирами, рефералами и барабаном. Напишите вопрос чуть точнее.';
  if (lang === 'en') return 'I can help with Durak rules, strategy, shop, Premium, tournaments, referrals, and baraban. Please ask a bit more specifically.';
  return "Durak qoidalari, strategiya, do'kon, Premium, turnir, referal yoki baraban haqida yordam bera olaman. Savolni biroz aniqroq yozing.";
}

function normalizeQuestion(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[‘’`]/g, "'")
    .replace(/o['‘’]?/g, 'o')
    .replace(/g['‘’]?/g, 'g')
    .replace(/[^a-zа-яё0-9$]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function contextText(context) {
  if (!context) return '';
  const table = (context.table || [])
    .map((p) => p.defense ? `${p.attack}-${p.defense}` : p.attack)
    .filter(Boolean)
    .join(', ') || 'empty';
  const players = (context.players || [])
    .map((p) => `${p.isMe ? 'me' : p.name}: ${p.cards} cards`)
    .join('; ');
  return [
    `phase: ${context.phase || ''}`,
    `trump: ${context.trumpCard || context.trumpSuit || ''}`,
    `deck: ${context.deckRemaining ?? ''}`,
    `table: ${table}`,
    `my cards: ${(context.myCards || []).join(', ') || 'hidden'}`,
    `attacker: ${context.attacker || ''}`,
    `defender: ${context.defender || ''}`,
    `active player: ${context.activePlayer || ''}`,
    `players: ${players}`,
    `safe suggestion: ${context.suggestion || ''}`,
  ].join('\n');
}

function wantsGameAdvice(question) {
  return /nima|qaysi|yur|ur|olay|pas|maslahat|hod|ход|что.*ход|какую|play|move|beat|take|pass|hint|advice/i.test(question);
}

function contextualAnswer(question, context, lang) {
  if (!context || !wantsGameAdvice(question)) return '';
  const suggestion = context.suggestion || '';
  const table = (context.table || []).map((p) => p.defense ? `${p.attack}-${p.defense}` : p.attack).filter(Boolean).join(', ');
  const mine = (context.myCards || []).join(', ');
  if (lang === 'ru') {
    return `По текущему столу мой безопасный совет: ${suggestion} Козырь: ${context.trumpCard || context.trumpSuit || 'не видно'}. На столе: ${table || 'пусто'}. Ваши карты: ${mine || 'не видно'}.`;
  }
  if (lang === 'en') {
    return `From the current table, my safe advice is: ${suggestion} Trump: ${context.trumpCard || context.trumpSuit || 'unknown'}. Table: ${table || 'empty'}. Your cards: ${mine || 'hidden'}.`;
  }
  return `Hozirgi stol bo'yicha maslahat: ${suggestion} Kozir: ${context.trumpCard || context.trumpSuit || 'korinmayapti'}. Stolda: ${table || 'bo\'sh'}. Sizdagi kartalar: ${mine || 'korinmayapti'}.`;
}

function ruleBased(question, context = null) {
  const lang = languageOf(question);
  if (BLOCKED_PATTERNS.some((p) => p.test(question))) return blockedReply(lang);
  const contextReply = contextualAnswer(question, context, lang);
  if (contextReply) return contextReply;
  const normalized = normalizeQuestion(question);
  const intent = INTENT_RULES.find((r) => r.keys.some((p) => p.test(question) || p.test(normalized)));
  if (intent) return intent[lang] || intent.uz;
  const rule = RULES.find((r) => r.keys.some((p) => p.test(question) || p.test(normalized)));
  return rule ? rule[lang] : defaultReply(lang);
}

async function hasWebGPU() {
  try {
    if (!navigator.gpu) return false;
    return !!await navigator.gpu.requestAdapter();
  } catch {
    return false;
  }
}

async function loadWebLLMEngine(onProgress) {
  if (!window.__webllm) {
    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = WEBLLM_CDN;
      s.type = 'module';
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }
  const { CreateMLCEngine } = window.__webllm || await import(WEBLLM_CDN);
  return CreateMLCEngine(WEBLLM_MODEL_ID, {
    initProgressCallback: (report) => onProgress?.(report.progress || 0, report.text || ''),
  });
}

export async function initAI(onProgress) {
  if (_initPromise) return _initPromise;
  _initPromise = (async () => {
    if (await hasWebGPU()) {
      try {
        onProgress?.(0, 'AI modeli yuklanmoqda...');
        _webllmEngine = await loadWebLLMEngine(onProgress);
        _engineMode = 'webllm';
        onProgress?.(1, 'AI tayyor');
        return 'webllm';
      } catch (err) {
        console.warn('[aiChat] WebLLM failed, using rules:', err.message);
      }
    }
    _engineMode = 'rules';
    onProgress?.(1, 'AI tayyor');
    return 'rules';
  })();
  return _initPromise;
}

export function isLimitReached(_userId, _isPremium) {
  return false;
}

export function remainingToday(_userId, isPremium) {
  return isPremium ? Infinity : FREE_DAILY_LIMIT;
}

export async function askAI(question, _userId, _isPremium, onChunk, context = null) {
  const text = String(question || '').trim();
  if (!text) return '';
  const lang = languageOf(text);

  if (BLOCKED_PATTERNS.some((p) => p.test(text))) {
    const reply = blockedReply(lang);
    onChunk?.(reply, true);
    return reply;
  }

  const normalized = normalizeQuestion(text);
  if (INTENT_RULES.some((r) => r.keys.some((p) => p.test(text) || p.test(normalized)))) {
    const answer = ruleBased(text, context);
    const words = answer.split(' ');
    let built = '';
    for (let i = 0; i < words.length; i += 1) {
      built += (i ? ' ' : '') + words[i];
      onChunk?.(built, false);
      if (i % 4 === 3) await new Promise((r) => setTimeout(r, 18));
    }
    onChunk?.(built, true);
    return built;
  }

  if (_engineMode === 'webllm' && _webllmEngine) {
    try {
      let full = '';
      const stream = await _webllmEngine.chat.completions.create({
        messages: [
          { role: 'system', content: `${SYSTEM_PROMPT}\n\nCurrent visible game context. Never reveal hidden opponent cards; use only this visible state:\n${contextText(context)}` },
          { role: 'user', content: text },
        ],
        stream: true,
        max_tokens: 240,
      });
      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content || '';
        if (!delta) continue;
        full += delta;
        onChunk?.(full, false);
      }
      onChunk?.(full, true);
      return full;
    } catch (err) {
      console.warn('[aiChat] WebLLM inference failed, using rules:', err.message);
    }
  }

  const answer = ruleBased(text, context);
  const words = answer.split(' ');
  let built = '';
  for (let i = 0; i < words.length; i += 1) {
    built += (i ? ' ' : '') + words[i];
    onChunk?.(built, false);
    if (i % 4 === 3) await new Promise((r) => setTimeout(r, 18));
  }
  onChunk?.(built, true);
  return built;
}

export function resetAI() {
  _engineMode = null;
  _webllmEngine = null;
  _initPromise = null;
}
