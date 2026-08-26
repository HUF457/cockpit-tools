/**
 * Fork-level build-time feature switches (HUF457/cockpit-tools).
 *
 * This fork ships with all promo surfaces disabled: the rotating top promo
 * banner, the sponsor ("中转站" / APIKEY.FUN) sidebar & dashboard entries and
 * the sponsor provider templates. Upstream behaviour can be restored without
 * reverting any code by building with `VITE_ENABLE_PROMO_SURFACES=1`.
 */
export const PROMO_SURFACES_ENABLED: boolean =
  import.meta.env.VITE_ENABLE_PROMO_SURFACES === '1';
