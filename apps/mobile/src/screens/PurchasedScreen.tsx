import { calculateAllInCost } from '@cardflows/shared';
import { useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

interface CostFormState {
  currency: string;
  purchasePrice: string;
  purchasedAt: string;
  shipping: string;
  tax: string;
  fees: string;
  supplies: string;
}

export function PurchasedScreen() {
  const [form, setForm] = useState<CostFormState>({
    currency: 'USD',
    purchasePrice: '',
    purchasedAt: new Date().toISOString(),
    shipping: '',
    tax: '',
    fees: '',
    supplies: '',
  });

  const [allInTotal, setAllInTotal] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function updateField(field: keyof CostFormState, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
    setError(null);
  }

  function calculateTotal() {
    if (!form.purchasePrice.trim()) {
      setError('Purchase price is required');
      return;
    }

    try {
      const result = calculateAllInCost({
        currency: form.currency,
        purchasePrice: form.purchasePrice,
        purchasedAt: form.purchasedAt,
        shipping: form.shipping || undefined,
        tax: form.tax || undefined,
        fees: form.fees || undefined,
        supplies: form.supplies || undefined,
      });

      setAllInTotal(result.allInTotal);
      setError(null);

      Alert.alert(
        'Cost Calculated',
        `All-in total: $${result.allInTotal}\n\n` +
          `Purchase Price: $${result.purchasePrice}\n` +
          `Shipping: $${result.shipping}\n` +
          `Tax: $${result.tax}\n` +
          `Fees: $${result.fees}\n` +
          `Supplies: $${result.supplies}\n\n` +
          `Total (cents): ${result.allInTotalCents}¢`,
        [{ text: 'OK' }]
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Invalid input';
      setError(message);
    }
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.container}
    >
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={styles.title}>Purchased Cost Collection</Text>
        <Text style={styles.subtitle}>Record your purchase costs</Text>

        <View style={styles.form}>
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Required Fields</Text>

            <View style={styles.field}>
              <Text style={styles.label}>
                Currency <Text style={styles.required}>*</Text>
              </Text>
              <TextInput
                style={styles.input}
                value={form.currency}
                onChangeText={(value) => updateField('currency', value)}
                placeholder="USD"
                placeholderTextColor="#64748b"
                autoCapitalize="characters"
              />
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>
                Purchase Price <Text style={styles.required}>*</Text>
              </Text>
              <TextInput
                style={styles.input}
                value={form.purchasePrice}
                onChangeText={(value) => updateField('purchasePrice', value)}
                placeholder="0.00"
                placeholderTextColor="#64748b"
                keyboardType="decimal-pad"
              />
              <Text style={styles.hint}>Enter amount in dollars (e.g. 3.50)</Text>
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>
                Purchased At <Text style={styles.required}>*</Text>
              </Text>
              <Text style={styles.dateDisplay}>{new Date(form.purchasedAt).toLocaleString()}</Text>
              <Text style={styles.hint}>Current timestamp (auto-filled)</Text>
            </View>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Optional Fields (default: $0.00)</Text>

            <View style={styles.field}>
              <Text style={styles.label}>Shipping</Text>
              <TextInput
                style={styles.input}
                value={form.shipping}
                onChangeText={(value) => updateField('shipping', value)}
                placeholder="0.00"
                placeholderTextColor="#64748b"
                keyboardType="decimal-pad"
              />
              <Text style={styles.hint}>Inbound shipping allocated to this copy</Text>
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>Tax</Text>
              <TextInput
                style={styles.input}
                value={form.tax}
                onChangeText={(value) => updateField('tax', value)}
                placeholder="0.00"
                placeholderTextColor="#64748b"
                keyboardType="decimal-pad"
              />
              <Text style={styles.hint}>Sales tax / VAT allocated to this copy</Text>
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>Fees</Text>
              <TextInput
                style={styles.input}
                value={form.fees}
                onChangeText={(value) => updateField('fees', value)}
                placeholder="0.00"
                placeholderTextColor="#64748b"
                keyboardType="decimal-pad"
              />
              <Text style={styles.hint}>Buy-side platform or payment fees</Text>
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>Supplies</Text>
              <TextInput
                style={styles.input}
                value={form.supplies}
                onChangeText={(value) => updateField('supplies', value)}
                placeholder="0.00"
                placeholderTextColor="#64748b"
                keyboardType="decimal-pad"
              />
              <Text style={styles.hint}>Sleeves, toploaders, penny sleeves</Text>
            </View>
          </View>

          <View style={styles.actions}>
            <Text
              style={styles.calculateButton}
              onPress={calculateTotal}
              accessibilityRole="button"
              accessibilityLabel="Calculate all-in total"
            >
              Calculate All-In Total
            </Text>
          </View>

          {error && (
            <View style={styles.errorContainer}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          {allInTotal && !error && (
            <View style={styles.resultContainer}>
              <Text style={styles.resultLabel}>All-In Total:</Text>
              <Text style={styles.resultValue}>${allInTotal}</Text>
              <Text style={styles.resultHint}>
                Formula: purchase_price + shipping + tax + fees + supplies
              </Text>
              <Text style={styles.resultHint}>Amounts persisted in cents; displayed in dollars</Text>
            </View>
          )}

          <View style={styles.infoBox}>
            <Text style={styles.infoTitle}>About Cost Collection</Text>
            <Text style={styles.infoText}>
              • Missing Max Buy reference does not block save
            </Text>
            <Text style={styles.infoText}>
              • Asking vs all-in is &ldquo;spread&rdquo; or &ldquo;cost-to-ask gap&rdquo;
            </Text>
            <Text style={styles.infoText}>• Never labeled as &ldquo;profit&rdquo;</Text>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f172a',
  },
  scrollContent: {
    padding: 24,
    paddingTop: 64,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#f8fafc',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: '#94a3b8',
    marginBottom: 24,
  },
  form: {
    gap: 24,
  },
  section: {
    gap: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#e2e8f0',
    marginBottom: 4,
  },
  field: {
    gap: 6,
  },
  label: {
    fontSize: 14,
    fontWeight: '500',
    color: '#cbd5e1',
  },
  required: {
    color: '#f87171',
  },
  input: {
    backgroundColor: '#1e293b',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    color: '#f8fafc',
  },
  hint: {
    fontSize: 12,
    color: '#64748b',
  },
  dateDisplay: {
    backgroundColor: '#1e293b',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 8,
    padding: 12,
    fontSize: 14,
    color: '#94a3b8',
  },
  actions: {
    marginTop: 8,
  },
  calculateButton: {
    backgroundColor: '#3b82f6',
    padding: 16,
    borderRadius: 8,
    fontSize: 16,
    fontWeight: '600',
    color: '#ffffff',
    textAlign: 'center',
    overflow: 'hidden',
  },
  errorContainer: {
    backgroundColor: '#7f1d1d',
    borderWidth: 1,
    borderColor: '#991b1b',
    borderRadius: 8,
    padding: 12,
  },
  errorText: {
    color: '#fca5a5',
    fontSize: 14,
  },
  resultContainer: {
    backgroundColor: '#1e293b',
    borderWidth: 2,
    borderColor: '#22c55e',
    borderRadius: 12,
    padding: 16,
    gap: 6,
  },
  resultLabel: {
    fontSize: 14,
    color: '#94a3b8',
  },
  resultValue: {
    fontSize: 32,
    fontWeight: '700',
    color: '#22c55e',
  },
  resultHint: {
    fontSize: 12,
    color: '#64748b',
  },
  infoBox: {
    backgroundColor: '#1e293b',
    borderRadius: 8,
    padding: 16,
    gap: 8,
    marginTop: 8,
  },
  infoTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#cbd5e1',
    marginBottom: 4,
  },
  infoText: {
    fontSize: 13,
    color: '#94a3b8',
    lineHeight: 18,
  },
});
