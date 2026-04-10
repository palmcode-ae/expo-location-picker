import * as React from 'react';

import { ExpoLocationPickerViewProps } from './ExpoLocationPicker.types';

export default function ExpoLocationPickerView(props: ExpoLocationPickerViewProps) {
  return (
    <div>
      <iframe
        style={{ flex: 1 }}
        src={props.url}
        onLoad={() => props.onLoad({ nativeEvent: { url: props.url } })}
      />
    </div>
  );
}
