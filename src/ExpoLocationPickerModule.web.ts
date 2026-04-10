import { registerWebModule, NativeModule } from 'expo';

import { ExpoLocationPickerModuleEvents } from './ExpoLocationPicker.types';

class ExpoLocationPickerModule extends NativeModule<ExpoLocationPickerModuleEvents> {
  PI = Math.PI;
  async setValueAsync(value: string): Promise<void> {
    this.emit('onChange', { value });
  }
  hello() {
    return 'Hello world! 👋';
  }
}

export default registerWebModule(ExpoLocationPickerModule, 'ExpoLocationPickerModule');
