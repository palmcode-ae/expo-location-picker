import { requireNativeView } from 'expo';
import * as React from 'react';

import { ExpoLocationPickerViewProps } from './ExpoLocationPicker.types';

const NativeView: React.ComponentType<ExpoLocationPickerViewProps> =
  requireNativeView('ExpoLocationPicker');

export default function ExpoLocationPickerView(props: ExpoLocationPickerViewProps) {
  return <NativeView {...props} />;
}
