import { StyleSheet, Text, View } from "react-native";
import { colors, spacing } from "../theme";

export function LoadingRows({
  label,
  count = 3,
}: {
  label: string;
  count?: number;
}) {
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityLiveRegion="polite"
      style={styles.container}
    >
      <Text style={styles.label}>{label}…</Text>
      {Array.from({ length: count }, (_, index) => (
        <View key={index} style={styles.row}>
          <View style={styles.marker} />
          <View style={styles.copy}>
            <View style={styles.title} />
            <View style={[styles.line, index % 2 === 0 && styles.shortLine]} />
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { minHeight: 210, paddingVertical: spacing.sm },
  label: { color: colors.inkMuted, fontSize: 12, marginBottom: spacing.sm },
  row: {
    minHeight: 62,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
  },
  marker: { width: 28, height: 28, borderRadius: 14, backgroundColor: "#E9E1D5" },
  copy: { flex: 1, gap: 7 },
  title: { width: "52%", height: 9, backgroundColor: "#E4DACC" },
  line: { width: "78%", height: 7, backgroundColor: "#EEE7DC" },
  shortLine: { width: "64%" },
});
