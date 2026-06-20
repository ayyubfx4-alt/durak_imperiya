// Capacitor native bridge — runs in the WebView shell on Android / iOS.
// When the app is loaded in a browser these calls all degrade to no-ops or
// stubs that emit synthetic results so the same code paths work everywhere.
//
// Wires up:
//   • Google Play Billing & App Store IAP (cordova-plugin-purchase)
//   • AdMob rewarded videos (@capacitor-community/admob)
//   • Push notifications (@capacitor/push-notifications)
//   • Status bar & safe-area
//
// All plugins are dynamic-imported so the web build doesn't pull native code.

const isCapacitor = !!(typeof window !== 'undefined' && window.Capacitor?.isNativePlatform?.());

export const native = {
  /** True when running inside the Capacitor shell. */
  isNative: () => isCapacitor,
  platform: () => (isCapacitor ? window.Capacitor.getPlatform() : 'web'),
};

const REWARD_AD_EVENTS = {
  Loaded: 'onRewardedVideoAdLoaded',
  FailedToLoad: 'onRewardedVideoAdFailedToLoad',
  Showed: 'onRewardedVideoAdShowed',
  FailedToShow: 'onRewardedVideoAdFailedToShow',
  Dismissed: 'onRewardedVideoAdDismissed',
  Rewarded: 'onRewardedVideoAdReward',
};

function cleanString(value) {
  return String(value || '').trim();
}

function rewardedAdUnitId() {
  const platform = native.platform();
  if (platform === 'ios') {
    return cleanString(window.__ADMOB_REWARDED_IOS_ID__ || window.__ADMOB_REWARDED_ID__);
  }
  return cleanString(window.__ADMOB_REWARDED_ANDROID_ID__ || window.__ADMOB_REWARDED_ID__);
}

function buildRewardSsv(userId) {
  const safeUserId = cleanString(userId);
  if (!safeUserId) return null;
  return {
    userId: safeUserId,
    customData: JSON.stringify({ userId: safeUserId, source: 'durak-imperia' }),
  };
}

async function loadAdMobPlugin() {
  const bridged = window.Capacitor?.Plugins?.AdMob;
  if (bridged) return { AdMob: bridged, RewardAdPluginEvents: REWARD_AD_EVENTS };

  try {
    const mod = await import('@capacitor-community/admob');
    return {
      AdMob: mod.AdMob,
      RewardAdPluginEvents: mod.RewardAdPluginEvents || REWARD_AD_EVENTS,
    };
  } catch (e) {
    throw new Error('AdMob native plugin is not available in this build');
  }
}

// ── AdMob rewarded video ────────────────────────────────────────────────
// Rewards are credited only after Google's signed SSV callback reaches
// /api/admob/ssv. Browser fallback never grants coins in production.
let admobReady = false;
async function ensureAdMob() {
  if (admobReady || !isCapacitor) return admobReady;
  try {
    const { AdMob } = await loadAdMobPlugin();
    await AdMob.initialize({
      requestTrackingAuthorization: true,
      testingDevices: [],
      initializeForTesting: window.__ADMOB_TEST__ === true,
    });
    admobReady = true;
  } catch (e) {
    console.warn('[native] AdMob init failed:', e?.message);
  }
  return admobReady;
}

export async function showRewardedAd(options = {}) {
  const userId = typeof options === 'string' ? options : options?.userId;
  if (!isCapacitor) {
    // Web fallback — the server only credits when the request originates
    // from a verified native callback, so this is harmless for production.
    return {
      reward: null,
      completed: false,
      source: 'web',
      error: 'Rewarded ads are available in the Android/iOS app only',
    };
  }
  await ensureAdMob();
  try {
    const { AdMob, RewardAdPluginEvents } = await loadAdMobPlugin();
    const adId = rewardedAdUnitId();
    if (!adId) throw new Error('Rewarded AdMob unit id is not configured');
    const ssv = buildRewardSsv(userId);
    if (!ssv) throw new Error('User id is required for AdMob SSV rewards');
    const listenerHandles = [];
    const listenerReady = [];
    let settled = false;

    function cleanupListeners() {
      while (listenerHandles.length) {
        const handle = listenerHandles.pop();
        try { handle?.remove?.(); } catch (_) {}
      }
    }

    const rewardPromise = new Promise((resolve) => {
      const finish = (value) => {
        if (settled) return;
        settled = true;
        cleanupListeners();
        resolve(value);
      };
      listenerReady.push(Promise.resolve(AdMob.addListener(RewardAdPluginEvents.Rewarded, (reward) => {
        finish({ reward, completed: true, source: 'admob-native', ssvPending: true });
      })).then((handle) => listenerHandles.push(handle)).catch(() => {}));
      listenerReady.push(Promise.resolve(AdMob.addListener(RewardAdPluginEvents.Dismissed, () => {
        finish({ reward: null, completed: false, source: 'admob-native' });
      })).then((handle) => listenerHandles.push(handle)).catch(() => {}));
      listenerReady.push(Promise.resolve(AdMob.addListener(RewardAdPluginEvents.FailedToShow, (error) => {
        finish({ reward: null, completed: false, source: 'admob-native', error: error?.message || 'ad failed to show' });
      })).then((handle) => listenerHandles.push(handle)).catch(() => {}));
    });

    await Promise.all(listenerReady);
    await AdMob.prepareRewardVideoAd({ adId, ssv });
    const shownReward = await AdMob.showRewardVideoAd();
    const eventResult = await Promise.race([
      rewardPromise,
      new Promise((resolve) => setTimeout(() => resolve(null), 1500)),
    ]);
    if (eventResult) return eventResult;
    cleanupListeners();
    if (shownReward) {
      return { reward: shownReward, completed: true, source: 'admob-native', ssvPending: true };
    }
    return { reward: null, completed: false, source: 'admob-native' };
  } catch (e) {
    console.warn('[native] showRewardedAd failed:', e?.message);
    return { reward: null, completed: false, source: 'admob-native', error: e?.message };
  }
}

// ── In-App Purchases (Google Play / App Store) ──────────────────────────
// The native side returns a `receipt` (Android: purchaseToken; iOS: signed
// receipt) that we hand to the backend `/api/shop/verify-iap` endpoint.
export async function buyProduct(productId) {
  if (!isCapacitor) {
    return { ok: false, error: 'IAP requires the native app (open in Google Play / App Store).' };
  }
  try {
    const cdvPurchase = window.CdvPurchase;
    if (cdvPurchase?.store) {
      const store = cdvPurchase.store;
      const platform = native.platform() === 'ios'
        ? cdvPurchase.Platform.APPLE_APPSTORE
        : cdvPurchase.Platform.GOOGLE_PLAY;
      const type = String(productId).startsWith('premium_')
        ? cdvPurchase.ProductType.PAID_SUBSCRIPTION
        : cdvPurchase.ProductType.CONSUMABLE;
      if (!store.get(productId, platform)) {
        store.register([{ id: productId, type, platform }]);
        await store.initialize([platform]);
      }
      await store.update();
      const product = store.get(productId, platform);
      const offer = product?.getOffer?.();
      if (!offer) throw new Error('IAP product is not available in the store');
      const order = await offer.order();
      const transaction = order?.transaction || order;
      const receipt = transaction?.purchaseToken
        || transaction?.transactionReceipt
        || transaction?.receipt
        || transaction?.id
        || '';
      if (!receipt) throw new Error('Store did not return a purchase receipt');
      return { ok: true, productId, receipt, platform: native.platform(), raw: order };
    }

    const plugin = await import('capacitor-plugin-purchase').catch(() => null);
    const Purchases = plugin?.Purchases || plugin?.InAppPurchases || plugin?.default;
    if (!Purchases) throw new Error('IAP plugin not installed');
    const result = await Purchases.purchase({ productId });
    return {
      ok: true,
      productId,
      receipt: result.receipt || result.purchaseToken || result.transactionReceipt,
      platform: window.Capacitor.getPlatform(),
      raw: result,
    };
  } catch (e) {
    return { ok: false, error: e?.message || 'purchase failed' };
  }
}

/** Verify a native purchase receipt with the backend. */
export async function submitReceiptToBackend(api, { productId, receipt, platform }) {
  if (!receipt || !productId) throw new Error('receipt and productId required');
  const result = await api.post('/shop/verify-iap', { platform, productId, receipt });
  try {
    const raw = arguments[1]?.raw;
    await raw?.transaction?.finish?.();
    await raw?.finish?.();
  } catch (e) {
    console.warn('[native] finish purchase failed:', e?.message);
  }
  return result;
}

// ── Push notifications (FCM via Capacitor) ─────────────────────────────
export async function initPush(onToken) {
  if (!isCapacitor) return null;
  try {
    const { PushNotifications } = await import('@capacitor/push-notifications');
    const perm = await PushNotifications.requestPermissions();
    if (perm.receive !== 'granted') return null;
    await PushNotifications.register();
    PushNotifications.addListener('registration', (token) => {
      onToken?.(token.value);
    });
    PushNotifications.addListener('pushNotificationReceived', (n) => {
      // Foreground notification → emit a popup via the existing event system.
      window.dispatchEvent(new CustomEvent('push:foreground', { detail: n }));
    });
    PushNotifications.addListener('pushNotificationActionPerformed', (a) => {
      window.dispatchEvent(new CustomEvent('push:action', { detail: a }));
    });
  } catch (e) {
    console.warn('[native] push init failed:', e?.message);
  }
}

// ── Status bar / safe area ──────────────────────────────────────────────
export async function configureNativeShell() {
  if (!isCapacitor) return;

  // APK performance flags - o'yin qotib qolmasin
  window.__DURAK_PERF_LITE__ = true;
  window.__DURAK_DISABLE_BLUR__ = true;
  window.__DURAK_MAX_FPS__ = 15;

  // HTML ga native class qo'sh
  document.documentElement.classList.add('capacitor-native');

  try {
    const { StatusBar, Style } = await import('@capacitor/status-bar');
    await StatusBar.setOverlaysWebView?.({ overlay: false });
    await StatusBar.setStyle({ style: Style.Dark });
    await StatusBar.setBackgroundColor({ color: '#0d0f1a' });
  } catch (_) { /* ignore */ }
  try {
    const { SafeArea } = await import('capacitor-plugin-safe-area');
    const { insets } = await SafeArea.getSafeAreaInsets();
    const root = document.documentElement;
    const top = Number(insets.top || 0);
    const right = Number(insets.right || 0);
    const bottom = Number(insets.bottom || 0);
    const left = Number(insets.left || 0);
    root.style.setProperty('--safe-top', `${top}px`);
    root.style.setProperty('--safe-bottom', `${bottom}px`);
    root.style.setProperty('--safe-left', `${left}px`);
    root.style.setProperty('--safe-right', `${right}px`);
    root.style.setProperty('--durak-safe-top', `${top}px`);
    root.style.setProperty('--durak-safe-bottom', `${bottom}px`);
    root.style.setProperty('--durak-safe-left', `${left}px`);
    root.style.setProperty('--durak-safe-right', `${right}px`);
  } catch (_) { /* ignore */ }
}
