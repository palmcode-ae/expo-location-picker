import { NativeModule, requireNativeModule } from 'expo';

import type {
  PickLocationOptions,
  PickLocationResult,
} from './ExpoLocationPicker.types';

declare class ExpoLocationPickerModule extends NativeModule {
  pickLocation(
    options?: PickLocationOptions,
  ): Promise<PickLocationResult | null>;
}

// Loads the native module from the JSI.
export default requireNativeModule<ExpoLocationPickerModule>(
  'ExpoLocationPicker',
);
