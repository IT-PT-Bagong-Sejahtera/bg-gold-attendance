import { SafeAreaView } from "react-native-safe-area-context";
import { StyleSheet, View, type ViewProps } from "react-native";
import { colors } from "../theme";

export function Screen({ children, style, ...props }: ViewProps) {
  return <SafeAreaView style={styles.safe}><View {...props} style={[styles.body, style]}>{children}</View></SafeAreaView>;
}
const styles = StyleSheet.create({ safe: { flex: 1, backgroundColor: colors.ivory }, body: { flex: 1, backgroundColor: colors.ivory } });

