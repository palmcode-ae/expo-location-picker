import { useState } from 'react';
import {
  Button,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  pickLocation,
  type PickLocationResult,
} from 'expo-location-picker';

export default function App() {
  const [result, setResult] = useState<PickLocationResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onPick = async () => {
    setError(null);
    try {
      // The web picker reads `process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY`
      // by default — set it in `example/.env` (see `example/.env.example`).
      // You can also override it per-call via `web: { apiKey: "..." }`.
      const value = await pickLocation({
        title: 'Pick a location',
        searchPlaceholder: 'Search anywhere…',
      });
      setResult(value);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.header}>expo-location-picker</Text>
        <Text style={styles.subheader}>
          Tap the button below to open the native picker.
        </Text>

        <View style={styles.buttonRow}>
          <Button title="Pick a location" onPress={onPick} />
        </View>

        {error && <Text style={styles.error}>Error: {error}</Text>}

        {result && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Selected location</Text>
            <Row label="Latitude" value={result.latitude.toFixed(6)} />
            <Row label="Longitude" value={result.longitude.toFixed(6)} />
            {result.formattedAddress && (
              <Row label="Address" value={result.formattedAddress} />
            )}
            {result.name && <Row label="Name" value={result.name} />}
            {result.locality && <Row label="City" value={result.locality} />}
            {result.country && <Row label="Country" value={result.country} />}
          </View>
        )}

        {result === null && !error && (
          <Text style={styles.muted}>No location picked yet.</Text>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f6f7f9' },
  content: { padding: 24, gap: 16 },
  header: { fontSize: 28, fontWeight: '700' },
  subheader: { fontSize: 14, color: '#555' },
  buttonRow: { marginVertical: 12 },
  error: { color: '#c62828' },
  muted: { color: '#888', fontStyle: 'italic' },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    gap: 8,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  cardTitle: { fontSize: 16, fontWeight: '600', marginBottom: 4 },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  rowLabel: { color: '#666', fontSize: 13 },
  rowValue: { color: '#111', fontSize: 13, flexShrink: 1, textAlign: 'right' },
});
