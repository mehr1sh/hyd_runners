/** Small shared UI pieces (no UI library, to keep the native surface small). */
import type { ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View, type ViewStyle } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export const colors = {
  navy: "#14213d",
  orange: "#f2652a",
  bg: "#f7f7f5",
  card: "#ffffff",
  text: "#1b1b1b",
  muted: "#5f6368",
  border: "#e2e2de",
  good: "#1e8e3e",
  fair: "#c58b00",
  poor: "#c5221f",
};

export function Screen({
  title,
  children,
  onBack,
  scroll = true,
}: {
  title: string;
  children: ReactNode;
  onBack?: () => void;
  scroll?: boolean;
}) {
  const body = <View style={styles.body}>{children}</View>;
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        {onBack ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={onBack} hitSlop={12}>
            <Text style={styles.back}>‹ Back</Text>
          </Pressable>
        ) : null}
        <Text accessibilityRole="header" style={styles.title}>
          {title}
        </Text>
      </View>
      {scroll ? <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>{body}</ScrollView> : body}
    </SafeAreaView>
  );
}

export function Button({
  label,
  onPress,
  kind = "primary",
  disabled,
  style,
}: {
  label: string;
  onPress: () => void;
  kind?: "primary" | "secondary" | "danger";
  disabled?: boolean;
  style?: ViewStyle;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        kind === "secondary" && styles.secondary,
        kind === "danger" && styles.danger,
        (pressed || disabled) && { opacity: 0.6 },
        style,
      ]}
    >
      <Text style={[styles.buttonText, kind === "secondary" && { color: colors.navy }]}>{label}</Text>
    </Pressable>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Choice<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <View style={styles.choices}>
      {options.map((o) => (
        <Pressable
          key={o.value}
          accessibilityRole="radio"
          accessibilityState={{ checked: o.value === value }}
          onPress={() => onChange(o.value)}
          style={[styles.choice, o.value === value && styles.choiceOn]}
        >
          <Text style={[styles.choiceText, o.value === value && { color: "#fff" }]}>{o.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4, gap: 4 },
  back: { color: colors.navy, fontSize: 16 },
  title: { fontSize: 24, fontWeight: "700", color: colors.navy },
  body: { paddingHorizontal: 16, gap: 12, paddingTop: 8, flex: 1 },
  p: { fontSize: 16, color: colors.text, lineHeight: 22 },
  muted: { fontSize: 14, color: colors.muted, lineHeight: 20 },
  h2: { fontSize: 18, fontWeight: "600", color: colors.navy },
  button: {
    backgroundColor: colors.orange,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    alignItems: "center",
  },
  secondary: { backgroundColor: "transparent", borderWidth: 1, borderColor: colors.navy },
  danger: { backgroundColor: colors.poor },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  card: {
    backgroundColor: colors.card,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 8,
  },
  choices: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  choice: { borderWidth: 1, borderColor: colors.navy, borderRadius: 999, paddingVertical: 6, paddingHorizontal: 12 },
  choiceOn: { backgroundColor: colors.navy },
  choiceText: { color: colors.navy, fontSize: 14 },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    padding: 12,
    fontSize: 16,
    backgroundColor: "#fff",
  },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 },
});
