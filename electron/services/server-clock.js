// ═══════════════════════════════════════════════════════════════════════════
// Server ki ghari — login token ki expiry PC ki ghari se NAHI jaanchi jati
// ---------------------------------------------------------------------------
// MASLA (16 Nov 2026, do paying customers): kai PCs ki ghari ghanton aage hoti
// hai — aksar time zone ghalat (misal: Beijing) aur ghanta haath se "theek" kiya
// hua, is liye screen par time sahi dikhta hai magar asal waqt ~13 ghante aage.
// App token ki expiry `Date.now()` se jaanchti thi, to har token (bilkul naya
// bhi) "expired" lagta. access-check phir token bhejta hi nahi tha, server
// (V3_ACCESS_REQUIRE_TOKEN) bina token "approved: false" deta, aur access diye
// hue customer ko pricing page dikhta. Ghari peeche ho to ulta: mara hua token
// "zinda" lagta aur bheja jata.
//
// HAL (industry ka tareeqa): waqt ka faisla server ka. Yahan sirf PC aur server
// ki ghari ka FARQ seekha jata hai — do jagah se, dono server ke likhe hue:
//   1. abhi abhi mile token ka `iat` (server ne kab banaya)
//   2. server ke jawab ka `Date` header
// aur expiry ka hisaab "PC ka waqt + farq" par hota hai.
//
// SECURITY par asar nahi: asal pehra server par hai — Supabase har token ka
// dastakhat aur expiry apni ghari se jaanchta hai. Ye check sirf sahulat hai
// ("refresh kab karna hai"); farq ghalat bhi ho jaye to zyada se zyada ek
// bekaar refresh ya server ka ek "dobara token lao" jawab.
//
// Farq sirf memory mein rehta hai, disk par nahi: user baad mein ghari theek
// kar de to purana farq na chipke. Har launch par pehle jawab se dobara seekha
// jata hai.
// ═══════════════════════════════════════════════════════════════════════════

/** Expiry se itna pehle naya token le lo (main.js ka purana `TOKEN_REFRESH_SKEW_MS`). */
const DEFAULT_REFRESH_SKEW_MS = 10 * 60 * 1000;

/** Itna farq ho to user ko ghari theek karne ka ishara dene layak (sirf UI ke liye). */
const NOTABLE_OFFSET_MS = 10 * 60 * 1000;

/** JWT ke claims, ya null. Dastakhat yahan nahi jaancha jata — wo server ka kaam hai. */
function readJwtClaims(jwt) {
  try {
    const payload = String(jwt || '').split('.')[1];
    if (!payload) return null;
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return claims && typeof claims === 'object' ? claims : null;
  } catch {
    return null;
  }
}

/** `exp` milliseconds mein (server ki ghari par), ya null. */
function tokenExpiryMs(jwt) {
  const claims = readJwtClaims(jwt);
  return claims && typeof claims.exp === 'number' ? claims.exp * 1000 : null;
}

/**
 * @param {{ localNow?: () => number }} [opts] — tests ke liye naqli ghari.
 */
function createServerClock({ localNow = () => Date.now() } = {}) {
  let offsetMs = 0;      // server ka waqt − PC ka waqt
  let hasSample = false; // kya kabhi server se seekha?

  const note = (serverMs) => {
    if (typeof serverMs !== 'number' || !Number.isFinite(serverMs) || serverMs <= 0) return false;
    offsetMs = Math.round(serverMs - localNow());
    hasSample = true;
    return true;
  };

  const now = () => localNow() + offsetMs;

  return {
    /** Server ke hisaab se abhi ka waqt (ms). */
    now,
    /** Server − PC (ms). Musbat = PC ki ghari peeche, manfi = aage. */
    offsetMs: () => offsetMs,
    hasSample: () => hasSample,
    /** Farq itna bara hai ke user ko batana chahiye? (sirf UI) */
    isOffsetNotable: () => hasSample && Math.abs(offsetMs) >= NOTABLE_OFFSET_MS,

    /**
     * Server jawab ka `Date` header (RFC 1123, second tak). Header second ke
     * shuru ka hota hai, is liye beech ka andaza (+500ms).
     */
    noteDateHeader(value) {
      if (typeof value !== 'string' || !value) return false;
      const t = Date.parse(value);
      return Number.isNaN(t) ? false : note(t + 500);
    },

    /**
     * SIRF abhi abhi server se mila token (PKCE exchange / refresh). Disk se
     * parha purana token yahan kabhi mat do — us ka `iat` purana hai.
     */
    noteFreshToken(jwt) {
      const claims = readJwtClaims(jwt);
      return claims && typeof claims.iat === 'number' ? note(claims.iat * 1000 + 500) : false;
    },

    /** Token abhi chalne layak hai (server ke waqt par, `skewMs` pehle tak)? */
    isTokenUsable(jwt, skewMs = DEFAULT_REFRESH_SKEW_MS) {
      const expiresAt = tokenExpiryMs(jwt);
      return expiresAt !== null && expiresAt - skewMs > now();
    },
  };
}

module.exports = {
  createServerClock,
  readJwtClaims,
  tokenExpiryMs,
  DEFAULT_REFRESH_SKEW_MS,
  NOTABLE_OFFSET_MS,
};
