import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { api, type Employee } from "../lib/api";
import { colors, spacing } from "../theme";

export function EmployeeKioskPINCard({ token }: { token: string }) {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [employeeId, setEmployeeId] = useState("");
  const [pin, setPIN] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let active = true;
    void api.employees(token)
      .then((items) => active && setEmployees(items.filter((item) => item.status === "ACTIVE" && item.roles.includes("EMPLOYEE"))))
      .catch((reason) => active && setError(reason instanceof Error ? reason.message : "Karyawan belum dapat dimuat."))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [token]);

  async function save() {
    setError(""); setNotice("");
    if (!employeeId) { setError("Pilih karyawan yang PIN-nya ingin diatur."); return; }
    if (!/^\d{6}$/.test(pin)) { setError("PIN harus terdiri dari tepat 6 angka."); return; }
    if (pin !== confirmation) { setError("Konfirmasi PIN belum sama."); return; }
    setSaving(true);
    try {
      await api.resetEmployeeKioskPIN(token, employeeId, pin);
      const employee = employees.find((item) => item.id === employeeId);
      setPIN(""); setConfirmation("");
      setNotice(`PIN ${employee?.fullName ?? "karyawan"} berhasil diperbarui.`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "PIN belum dapat diperbarui."); }
    finally { setSaving(false); }
  }

  return (
    <View style={styles.card}>
      <View style={styles.heading}><View style={styles.icon}><Ionicons name="keypad-outline" size={20} color={colors.espresso} /></View><View style={styles.headingCopy}><Text style={styles.kicker}>AKSES KIOSK</Text><Text style={styles.title}>Atur PIN karyawan</Text></View></View>
      <Text style={styles.copy}>Gunakan untuk karyawan lama atau saat PIN terlupa. PIN baru langsung menggantikan PIN sebelumnya.</Text>
      {loading ? <ActivityIndicator color={colors.gold} style={styles.loader} /> : (
        <View style={styles.list}>
          {employees.map((employee) => {
            const selected = employee.id === employeeId;
            return <Pressable accessibilityLabel={`Pilih ${employee.fullName} untuk atur PIN`} accessibilityRole="radio" accessibilityState={{ checked: selected }} key={employee.id} onPress={() => { setEmployeeId(employee.id); setError(""); setNotice(""); }} style={[styles.employee, selected && styles.selected]}><Ionicons name={selected ? "radio-button-on" : "radio-button-off"} size={20} color={selected ? colors.gold : colors.inkMuted} /><View style={styles.employeeCopy}><Text style={styles.name}>{employee.fullName}</Text><Text style={styles.meta}>{employee.employeeNumber}{employee.jobTitle ? ` · ${employee.jobTitle}` : ""}</Text></View></Pressable>;
          })}
          {!employees.length ? <Text style={styles.empty}>Belum ada karyawan aktif.</Text> : null}
        </View>
      )}
      {employeeId ? <View style={styles.pinFields}><View style={styles.field}><Text style={styles.label}>PIN baru</Text><TextInput accessibilityLabel="PIN kiosk baru" keyboardType="number-pad" maxLength={6} secureTextEntry value={pin} onChangeText={(value) => setPIN(value.replace(/\D/g, ""))} style={styles.input} /></View><View style={styles.field}><Text style={styles.label}>Ulangi PIN</Text><TextInput accessibilityLabel="Konfirmasi PIN kiosk baru" keyboardType="number-pad" maxLength={6} secureTextEntry value={confirmation} onChangeText={(value) => setConfirmation(value.replace(/\D/g, ""))} style={styles.input} /></View></View> : null}
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}{notice ? <Text style={styles.notice}>{notice}</Text> : null}
      <Pressable accessibilityRole="button" disabled={saving || loading || !employees.length} onPress={() => void save()} style={[styles.button, (saving || loading || !employees.length) && styles.disabled]}>{saving ? <ActivityIndicator color={colors.espresso} /> : <Text style={styles.buttonText}>Simpan PIN baru</Text>}</Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { marginTop: spacing.xl, padding: spacing.lg, borderRadius: 22, backgroundColor: "#F5EACB", borderWidth: 1, borderColor: "#E1CA8C" },
  heading: { flexDirection: "row", alignItems: "center", gap: 12 }, icon: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.goldSoft, alignItems: "center", justifyContent: "center" }, headingCopy: { flex: 1 },
  kicker: { color: "#7E6327", fontSize: 10, fontWeight: "800", letterSpacing: 1.4 }, title: { color: colors.espresso, fontFamily: "serif", fontSize: 23, marginTop: 2 }, copy: { color: colors.inkMuted, lineHeight: 19, marginTop: 13 }, loader: { marginVertical: 22 },
  list: { gap: 7, marginTop: 16 }, employee: { minHeight: 58, padding: 11, borderRadius: 14, borderWidth: 1, borderColor: "#D8C89E", backgroundColor: "#FFF9E9", flexDirection: "row", alignItems: "center", gap: 9 }, selected: { borderColor: colors.gold, backgroundColor: colors.paper }, employeeCopy: { flex: 1 }, name: { color: colors.espresso, fontWeight: "800" }, meta: { color: colors.inkMuted, fontSize: 10, marginTop: 3 }, empty: { color: colors.inkMuted },
  pinFields: { flexDirection: "row", gap: 10, marginTop: 16 }, field: { flex: 1 }, label: { color: colors.inkMuted, fontSize: 10, fontWeight: "700", marginBottom: 6 }, input: { height: 50, borderRadius: 13, borderWidth: 1, borderColor: "#CCB879", backgroundColor: colors.paper, color: colors.espresso, fontSize: 19, letterSpacing: 5, textAlign: "center" },
  error: { color: colors.ruby, marginTop: 12, lineHeight: 18 }, notice: { color: colors.emerald, marginTop: 12, lineHeight: 18 }, button: { minHeight: 52, borderRadius: 15, backgroundColor: colors.gold, alignItems: "center", justifyContent: "center", marginTop: 17 }, buttonText: { color: colors.espresso, fontWeight: "900" }, disabled: { opacity: .5 },
});
