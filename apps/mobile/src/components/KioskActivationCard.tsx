import { Ionicons } from "@expo/vector-icons";
import * as Device from "expo-device";
import { useEffect, useState } from "react";
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { api, type Section } from "../lib/api";
import { useKioskMode } from "../lib/kioskMode";
import { installationIdentifier } from "../lib/installationIdentifier";
import { colors, spacing } from "../theme";

export function KioskActivationCard({ token }: { token: string }) {
  const kioskMode = useKioskMode();
  const [sections, setSections] = useState<Section[]>([]);
  const [sectionId, setSectionId] = useState("");
  const [deviceLabel, setDeviceLabel] = useState(Device.modelName ? `Kiosk ${Device.modelName}` : "HP Kiosk Showroom");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void api.sections(token)
      .then((items) => {
        if (!active) return;
        const available = items.filter((item) => item.status === "ACTIVE");
        setSections(available);
        setSectionId((current) => current || available[0]?.id || "");
      })
      .catch((reason) => active && setError(reason instanceof Error ? reason.message : "Showroom belum dapat dimuat."))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [token]);

  async function activate() {
    const showroom = sections.find((item) => item.id === sectionId);
    if (!showroom || !deviceLabel.trim()) {
      setError("Pilih showroom dan beri nama perangkat ini.");
      return;
    }
    setSaving(true); setError("");
    try {
      const installationId = await installationIdentifier();
      const result = await api.activateKiosk(token, {
        sectionId: showroom.id,
        installationId,
        deviceLabel: deviceLabel.trim(),
        platform: Platform.OS === "ios" ? "IOS" : "ANDROID",
        deviceModel: Device.modelName ?? undefined,
      });
      await kioskMode.activate({
        id: result.id,
        token: result.token,
        deviceLabel: result.deviceLabel,
        showroom: { id: showroom.id, code: showroom.code, name: showroom.name, address: showroom.address },
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Mode kiosk belum dapat diaktifkan.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={styles.card}>
      <View style={styles.heading}>
        <View style={styles.icon}><Ionicons name="phone-portrait-outline" size={20} color={colors.gold} /></View>
        <View style={styles.headingCopy}><Text style={styles.kicker}>MODE 1 HP</Text><Text style={styles.title}>Aktifkan kiosk showroom</Text></View>
      </View>
      <Text style={styles.copy}>Perangkat akan terikat ke showroom, bukan ke satu karyawan. Seluruh karyawan dapat absen bergantian dengan PIN pribadi.</Text>
      {loading ? <ActivityIndicator color={colors.gold} style={styles.loader} /> : (
        <>
          <Text style={styles.label}>Master showroom</Text>
          <View style={styles.options}>
            {sections.map((section) => {
              const selected = section.id === sectionId;
              return <Pressable accessibilityRole="radio" accessibilityState={{ checked: selected }} key={section.id} onPress={() => setSectionId(section.id)} style={[styles.option, selected && styles.optionSelected]}>
                <Ionicons name={selected ? "radio-button-on" : "radio-button-off"} size={20} color={selected ? colors.gold : colors.inkMuted} />
                <View style={styles.optionCopy}><Text style={styles.optionName}>{section.name}</Text><Text style={styles.optionMeta}>{section.code}{section.address ? ` · ${section.address}` : ""}</Text></View>
              </Pressable>;
            })}
          </View>
          {!sections.length ? <Text style={styles.empty}>Belum ada showroom aktif. Tambahkan melalui Master Showroom di atas.</Text> : null}
          <Text style={styles.label}>Nama perangkat</Text>
          <TextInput accessibilityLabel="Nama perangkat kiosk" value={deviceLabel} onChangeText={setDeviceLabel} style={styles.input} />
        </>
      )}
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      <Pressable accessibilityRole="button" disabled={saving || loading || !sections.length} onPress={() => void activate()} style={[styles.button, (saving || loading || !sections.length) && styles.disabled]}>
        {saving ? <ActivityIndicator color={colors.espresso} /> : <Ionicons name="lock-closed-outline" size={18} color={colors.espresso} />}
        <Text style={styles.buttonText}>{saving ? "Mengaktifkan…" : "Aktifkan mode kiosk"}</Text>
      </Pressable>
      <Text style={styles.note}>Untuk keluar dari mode kiosk, supervisor harus memakai tombol khusus lalu masuk kembali.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { marginTop: spacing.xl, padding: spacing.lg, backgroundColor: colors.espresso, borderRadius: 22 },
  heading: { flexDirection: "row", alignItems: "center", gap: 12 },
  icon: { width: 42, height: 42, borderRadius: 21, backgroundColor: "#3A211A", alignItems: "center", justifyContent: "center" },
  headingCopy: { flex: 1 },
  kicker: { color: colors.goldSoft, fontSize: 10, fontWeight: "800", letterSpacing: 1.5 },
  title: { color: colors.white, fontFamily: "serif", fontSize: 23, marginTop: 2 },
  copy: { color: "#D8CFC4", lineHeight: 20, marginTop: 14 },
  loader: { marginVertical: 24 }, label: { color: colors.goldSoft, fontSize: 11, fontWeight: "700", marginTop: 18, marginBottom: 8 },
  options: { gap: 8 }, option: { flexDirection: "row", alignItems: "center", gap: 10, padding: 13, borderWidth: 1, borderColor: "#5C463E", borderRadius: 14 },
  optionSelected: { borderColor: colors.gold, backgroundColor: "#34221A" }, optionCopy: { flex: 1 }, optionName: { color: colors.white, fontWeight: "700" }, optionMeta: { color: "#BEB2A7", fontSize: 11, marginTop: 3 },
  input: { minHeight: 48, borderRadius: 12, backgroundColor: colors.paper, color: colors.espresso, paddingHorizontal: 14 }, empty: { color: colors.goldSoft, lineHeight: 18 },
  error: { color: "#FFC3C7", marginTop: 12, lineHeight: 18 }, button: { minHeight: 52, borderRadius: 15, marginTop: 20, backgroundColor: colors.gold, flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "center" },
  buttonText: { color: colors.espresso, fontWeight: "800" }, disabled: { opacity: .55 }, note: { color: "#AFA39A", fontSize: 10, lineHeight: 15, marginTop: 10, textAlign: "center" },
});
