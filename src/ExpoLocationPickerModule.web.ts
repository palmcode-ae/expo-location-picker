import type {
  PickLocationOptions,
  PickLocationResult,
} from './ExpoLocationPicker.types';
// Static import (not dynamic `await import()`) so Metro's dev server can
// resolve `./web/picker` at bundle time. We *did* originally use a dynamic
// import for code splitting — and `expo export --platform web` happily
// produced a separate ~20 KB picker chunk — but Metro's web *dev server*
// doesn't reliably resolve dynamic chunks across package boundaries in
// linked-source / monorepo setups. At runtime, the chunk loader tries to
// fetch the chunk URL relative to the consumer app's filesystem (the
// example app's dir) instead of the library's, producing a confusing
// "Unable to resolve module ./src/web/picker" error the first time
// pickLocation() is called.
//
// Metro's `inlineRequires: true` transformer (which Expo enables by
// default and which the example app keeps in metro.config.js) hoists
// top-level imports into lazy require() calls at the use site, so the
// picker module's top-level code is *still* deferred until the first
// pickLocation() call. The only thing we give up is the separate 20 KB
// chunk on the production export path — the picker code now lives in the
// main bundle instead. That's an acceptable trade for the dev server
// actually working.
import { showPicker } from './web/picker';

/**
 * Web implementation of `pickLocation()`.
 *
 * The actual picker (DOM construction, Google Maps integration, search,
 * geolocation, reverse geocoding) lives in `./web/picker`.
 */
export default {
  pickLocation(
    options?: PickLocationOptions,
  ): Promise<PickLocationResult | null> {
    return showPicker(options ?? {});
  },
};
