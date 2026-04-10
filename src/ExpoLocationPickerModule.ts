import { NativeModule, requireNativeModule } from 'expo';

import { ExpoLocationPickerModuleEvents } from './ExpoLocationPicker.types';

declare class ExpoLocationPickerModule extends NativeModule<ExpoLocationPickerModuleEvents> {
  PI: number;
  hello(): string;
  setValueAsync(value: string): Promise<void>;
}

// This call loads the native module object from the JSI.
export default requireNativeModule<ExpoLocationPickerModule>('ExpoLocationPicker');
