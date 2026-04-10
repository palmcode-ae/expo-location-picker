import type {
  PickLocationOptions,
  PickLocationResult,
  PickLocationTheme,
} from './ExpoLocationPicker.types';
import ExpoLocationPickerModule from './ExpoLocationPickerModule';

export type { PickLocationOptions, PickLocationResult, PickLocationTheme };

/**
 * Present a fully native, full-screen location picker over the current app.
 *
 * The user is shown a native map with a fixed center pin, a search bar, a
 * "current location" button, and Done / Cancel actions.
 *
 * - Resolves with a {@link PickLocationResult} when the user taps **Done**.
 * - Resolves with `null` when the user taps **Cancel** or dismisses the
 *   picker by gesture.
 *
 * Throws if called on web, or if presentation fails (for example, no view
 * controller / activity is currently available).
 */
export function pickLocation(
  options?: PickLocationOptions,
): Promise<PickLocationResult | null> {
  return ExpoLocationPickerModule.pickLocation(options ?? {});
}

export default { pickLocation };
