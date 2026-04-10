/**
 * Self-contained CSS for the web picker. Injected into `<head>` exactly
 * once on first picker open. All class names are prefixed with
 * `expo-location-picker__` to avoid colliding with consumer styles.
 *
 * Theming works via CSS custom properties on the `__dialog` element. The
 * picker controller sets these from the user's `theme` option at runtime
 * via `style.setProperty('--ep-...', value)`. Anything not overridden
 * falls back to the default in the `var(--ep-name, fallback)` reference.
 *
 * The variables we expose:
 *
 *   --ep-primary             accent color (Done button, FAB, focus rings)
 *   --ep-primary-contrast    text color on top of `--ep-primary`
 *   --ep-pin                 pin marker fill color
 *   --ep-surface             dialog / card background
 *   --ep-surface-elevated    search results dropdown background
 *   --ep-on-surface          primary text color on `--ep-surface`
 *   --ep-on-surface-muted    secondary / subtitle text color
 *   --ep-divider             border + separator color
 *   --ep-search-bg           search input background
 *   --ep-row-hover           result row hover background
 */

// `: string` annotation is intentional — without it TypeScript would
// infer the literal type of the entire CSS template, which produces a
// ~11 KB .d.ts file when the library is built. Annotating as `string`
// gives consumers a normal `export declare const STYLES: string` instead.
export const STYLES: string = `
/* ---------- defaults: light mode -------------------------------------- */
.expo-location-picker__dialog {
  --ep-primary: #007aff;
  --ep-primary-contrast: #ffffff;
  --ep-pin: #ff3b30;
  --ep-surface: #ffffff;
  --ep-surface-elevated: #ffffff;
  --ep-on-surface: #1f1f1f;
  --ep-on-surface-muted: #6b6b6b;
  --ep-divider: rgba(0, 0, 0, 0.08);
  --ep-search-bg: rgba(0, 0, 0, 0.06);
  --ep-row-hover: rgba(0, 0, 0, 0.05);
  --ep-shadow: rgba(0, 0, 0, 0.16);
}

/* Dark mode defaults follow the system… */
@media (prefers-color-scheme: dark) {
  .expo-location-picker__dialog {
    --ep-primary: #4f9bf2;
    --ep-primary-contrast: #ffffff;
    --ep-pin: #ff453a;
    --ep-surface: #1c1c1e;
    --ep-surface-elevated: #2c2c2e;
    --ep-on-surface: #f2f2f7;
    --ep-on-surface-muted: #98989f;
    --ep-divider: rgba(255, 255, 255, 0.1);
    --ep-search-bg: rgba(255, 255, 255, 0.1);
    --ep-row-hover: rgba(255, 255, 255, 0.08);
    --ep-shadow: rgba(0, 0, 0, 0.5);
  }
}

/* …unless the user explicitly forces a scheme via theme.colorScheme. */
.expo-location-picker__dialog--force-light {
  --ep-primary: #007aff;
  --ep-primary-contrast: #ffffff;
  --ep-pin: #ff3b30;
  --ep-surface: #ffffff;
  --ep-surface-elevated: #ffffff;
  --ep-on-surface: #1f1f1f;
  --ep-on-surface-muted: #6b6b6b;
  --ep-divider: rgba(0, 0, 0, 0.08);
  --ep-search-bg: rgba(0, 0, 0, 0.06);
  --ep-row-hover: rgba(0, 0, 0, 0.05);
  --ep-shadow: rgba(0, 0, 0, 0.16);
  color-scheme: light;
}
.expo-location-picker__dialog--force-dark {
  --ep-primary: #4f9bf2;
  --ep-primary-contrast: #ffffff;
  --ep-pin: #ff453a;
  --ep-surface: #1c1c1e;
  --ep-surface-elevated: #2c2c2e;
  --ep-on-surface: #f2f2f7;
  --ep-on-surface-muted: #98989f;
  --ep-divider: rgba(255, 255, 255, 0.1);
  --ep-search-bg: rgba(255, 255, 255, 0.1);
  --ep-row-hover: rgba(255, 255, 255, 0.08);
  --ep-shadow: rgba(0, 0, 0, 0.5);
  color-scheme: dark;
}

/* ---------- backdrop / scrim ----------------------------------------- */
/*
 * The backdrop is the *scrim* — a fixed-position dim layer that fills the
 * viewport. On large screens it darkens the page behind the centered
 * dialog. On mobile the dialog fills the scrim entirely so the dim is
 * fully covered (and effectively invisible).
 *
 * The scrim and dialog both fade/scale in from invisible on mount. The
 * controller toggles the "--visible" class one frame after attaching the
 * DOM, so the transitions actually fire.
 */
.expo-location-picker__backdrop {
  position: fixed;
  inset: 0;
  z-index: 2147483646;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
  touch-action: manipulation;
  transition: background-color 0.22s ease;
}
.expo-location-picker__backdrop--visible {
  background: rgba(0, 0, 0, 0.55);
}
@media (prefers-color-scheme: dark) {
  .expo-location-picker__backdrop--visible {
    background: rgba(0, 0, 0, 0.7);
  }
}

/* ---------- dialog ---------------------------------------------------- */
.expo-location-picker__dialog {
  background: var(--ep-surface);
  color: var(--ep-on-surface);
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  overflow: hidden;
  position: relative;
  opacity: 0;
  transform: scale(0.96);
  transition:
    opacity 0.22s ease,
    transform 0.28s cubic-bezier(0.16, 1, 0.3, 1);
}
.expo-location-picker__backdrop--visible .expo-location-picker__dialog {
  opacity: 1;
  transform: scale(1);
}

@media (min-width: 768px) {
  .expo-location-picker__dialog {
    width: min(640px, 92vw);
    height: min(720px, 90vh);
    border-radius: 20px;
    box-shadow:
      0 32px 96px rgba(0, 0, 0, 0.32),
      0 6px 16px rgba(0, 0, 0, 0.16);
  }
}

/* ---------- top bar --------------------------------------------------- */
.expo-location-picker__topbar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  background: var(--ep-surface);
  border-bottom: 1px solid var(--ep-divider);
  position: relative;
  z-index: 2;
}

.expo-location-picker__icon-button {
  width: 40px;
  height: 40px;
  min-width: 40px;
  border-radius: 50%;
  border: none;
  background: transparent;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--ep-on-surface);
  padding: 0;
  transition: background-color 0.15s ease, transform 0.1s ease;
}
.expo-location-picker__icon-button:hover {
  background: var(--ep-row-hover);
}
.expo-location-picker__icon-button:active {
  transform: scale(0.94);
}
.expo-location-picker__icon-button:focus-visible {
  outline: 2px solid var(--ep-primary);
  outline-offset: 2px;
}
.expo-location-picker__icon-button svg {
  width: 22px;
  height: 22px;
  display: block;
}
.expo-location-picker__icon-button--done {
  color: var(--ep-primary);
}

/* ---------- search input --------------------------------------------- */
.expo-location-picker__search-wrapper {
  flex: 1;
  position: relative;
  min-width: 0;
}

.expo-location-picker__search-input {
  width: 100%;
  height: 44px;
  border-radius: 22px;
  border: none;
  background: var(--ep-search-bg);
  padding: 0 16px;
  font-size: 16px;
  font-family: inherit;
  color: var(--ep-on-surface);
  outline: none;
  box-sizing: border-box;
  transition: background-color 0.15s ease, box-shadow 0.15s ease;
}
.expo-location-picker__search-input:focus {
  background: var(--ep-surface);
  box-shadow: 0 0 0 2px var(--ep-primary);
}
.expo-location-picker__search-input::placeholder {
  color: var(--ep-on-surface-muted);
}
/* Hide the WebKit search clear button — we have our own UX. */
.expo-location-picker__search-input::-webkit-search-cancel-button {
  -webkit-appearance: none;
  appearance: none;
}

/* ---------- search results dropdown ---------------------------------- */
.expo-location-picker__results {
  position: absolute;
  top: calc(100% + 8px);
  left: 0;
  right: 0;
  background: var(--ep-surface-elevated);
  border-radius: 16px;
  box-shadow: 0 16px 48px var(--ep-shadow);
  max-height: 380px;
  overflow-y: auto;
  z-index: 3;
  padding: 6px;
  display: none;
  animation: ep-fade-in 0.18s ease;
}
.expo-location-picker__results--visible {
  display: block;
}
@keyframes ep-fade-in {
  from { opacity: 0; transform: translateY(-4px); }
  to { opacity: 1; transform: translateY(0); }
}

.expo-location-picker__result-item {
  padding: 12px 14px;
  border-radius: 12px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 14px;
  transition: background-color 0.12s ease;
}
.expo-location-picker__result-item:hover,
.expo-location-picker__result-item--active {
  background: var(--ep-row-hover);
}
.expo-location-picker__result-icon {
  width: 24px;
  height: 24px;
  flex-shrink: 0;
  color: var(--ep-pin);
}
.expo-location-picker__result-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.expo-location-picker__result-title {
  font-size: 15px;
  color: var(--ep-on-surface);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.expo-location-picker__result-subtitle {
  font-size: 13px;
  color: var(--ep-on-surface-muted);
  margin-top: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ---------- map + pin overlay ---------------------------------------- */
.expo-location-picker__map-container {
  flex: 1;
  position: relative;
  overflow: hidden;
}
.expo-location-picker__map {
  position: absolute;
  inset: 0;
}

.expo-location-picker__pin {
  position: absolute;
  left: 50%;
  top: 50%;
  pointer-events: none;
  transform: translate(-50%, -100%);
  z-index: 4;
  transition: transform 0.24s cubic-bezier(0.2, 0.8, 0.2, 1);
  filter: drop-shadow(0 6px 10px rgba(0, 0, 0, 0.3));
}
.expo-location-picker__pin--lifted {
  transform: translate(-50%, calc(-100% - 14px));
}
/* The pin SVG inherits its fill from currentColor, which we set from
   --ep-pin. That's how the theme override flows down to the marker. */
.expo-location-picker__pin svg {
  display: block;
}
.expo-location-picker__pin svg .ep-pin-fill {
  fill: var(--ep-pin);
}

.expo-location-picker__pin-dot {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.55);
  border: 1px solid #ffffff;
  transform: translate(-50%, -50%);
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.22s ease;
  z-index: 3;
  box-sizing: border-box;
}
.expo-location-picker__pin-dot--visible {
  opacity: 1;
}

/* ---------- floating "current location" button ----------------------- */
.expo-location-picker__fab {
  position: absolute;
  bottom: 24px;
  right: 24px;
  width: 56px;
  height: 56px;
  border-radius: 50%;
  border: none;
  background: var(--ep-surface);
  color: var(--ep-primary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 8px 24px var(--ep-shadow), 0 2px 6px rgba(0, 0, 0, 0.1);
  z-index: 5;
  transition: transform 0.15s cubic-bezier(0.2, 0.8, 0.2, 1), box-shadow 0.15s ease;
}
.expo-location-picker__fab:hover {
  transform: scale(1.06);
  box-shadow: 0 12px 32px var(--ep-shadow), 0 4px 8px rgba(0, 0, 0, 0.12);
}
.expo-location-picker__fab:active {
  transform: scale(0.96);
}
.expo-location-picker__fab:focus-visible {
  outline: 2px solid var(--ep-primary);
  outline-offset: 3px;
}
.expo-location-picker__fab svg {
  width: 24px;
  height: 24px;
  display: block;
}
`;

let injected = false;

/** Inserts the picker stylesheet into `<head>` exactly once per page. */
export function injectStyles(): void {
  if (injected) return;
  if (typeof document === 'undefined') return;
  const style = document.createElement('style');
  style.id = '__expo-location-picker-styles';
  style.textContent = STYLES;
  document.head.appendChild(style);
  injected = true;
}
