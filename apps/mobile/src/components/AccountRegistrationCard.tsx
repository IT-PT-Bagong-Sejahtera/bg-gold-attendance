import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { api } from "../lib/api";
import { colors, spacing } from "../theme";

type AccountRole = "EMPLOYEE" | "SUPERVISOR";

export function AccountRegistrationCard({
  token,
  roles,
}: {
  token: string;
  roles: string[];
}) {
  const isSuperadmin = roles.includes("OWNER");
  const [accountRole, setAccountRole] = useState<AccountRole>("EMPLOYEE");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [kioskPIN, setKioskPIN] = useState("");
  const [kioskPINConfirmation, setKioskPINConfirmation] = useState("");
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function submit() {
    setError("");
    setNotice("");
    if (!fullName.trim() || !email.trim()) {
      setError("Nama dan email wajib diisi.");
      return;
    }
    if (password.length < 8) {
      setError("Kata sandi harus memiliki sedikitnya 8 karakter.");
      return;
    }
    if (password !== passwordConfirmation) {
      setError("Konfirmasi kata sandi belum sama.");
      return;
    }
    if (accountRole === "EMPLOYEE" && !/^\d{6}$/.test(kioskPIN)) {
      setError("PIN absensi harus terdiri dari tepat 6 angka.");
      return;
    }
    if (accountRole === "EMPLOYEE" && kioskPIN !== kioskPINConfirmation) {
      setError("Konfirmasi PIN absensi belum sama.");
      return;
    }
    setSaving(true);
    try {
      const created = await api.createEmployee(token, {
        fullName: fullName.trim(),
        email: email.trim().toLowerCase(),
        jobTitle: jobTitle.trim(),
        password,
        kioskPIN: accountRole === "EMPLOYEE" ? kioskPIN : "",
        roles: [accountRole],
      });
      setFullName("");
      setEmail("");
      setJobTitle("");
      setPassword("");
      setPasswordConfirmation("");
      setKioskPIN("");
      setKioskPINConfirmation("");
      setAccountRole("EMPLOYEE");
      setNotice(
        accountRole === "SUPERVISOR"
          ? `Akun supervisor berhasil dibuat dengan nomor ${created.employeeNumber}.`
          : `Akun karyawan berhasil dibuat dengan nomor ${created.employeeNumber}.`,
      );
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Akun belum dapat dibuat.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={styles.card}>
      <Text style={styles.kicker}>KELOLA AKUN</Text>
      <Text style={styles.title}>
        {isSuperadmin ? "Daftarkan anggota tim" : "Daftarkan karyawan"}
      </Text>
      <Text style={styles.copy}>
        {isSuperadmin
          ? "Superadmin dapat membuat akun karyawan atau supervisor."
          : "Supervisor dapat membuat akun masuk untuk karyawan di organisasi ini."}
      </Text>

      {isSuperadmin ? (
        <View style={styles.rolePicker} accessibilityRole="radiogroup">
          {(["EMPLOYEE", "SUPERVISOR"] as AccountRole[]).map((role) => {
            const selected = role === accountRole;
            return (
              <Pressable
                accessibilityLabel={role === "EMPLOYEE" ? "Karyawan" : "Supervisor"}
                accessibilityRole="radio"
                accessibilityState={{ checked: selected }}
                key={role}
                onPress={() => setAccountRole(role)}
                style={[styles.roleOption, selected && styles.roleOptionSelected]}
              >
                <Text style={[styles.roleText, selected && styles.roleTextSelected]}>
                  {role === "EMPLOYEE" ? "Karyawan" : "Supervisor"}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : (
        <View style={styles.fixedRole}>
          <Ionicons name="person-outline" size={17} color={colors.gold} />
          <Text style={styles.fixedRoleText}>Akun karyawan</Text>
        </View>
      )}

      <Field label="Nama lengkap">
        <TextInput
          accessibilityLabel="Nama lengkap akun baru"
          autoCapitalize="words"
          onChangeText={setFullName}
          style={styles.input}
          value={fullName}
        />
      </Field>
      <Field label="Email">
        <TextInput
          accessibilityLabel="Email akun baru"
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          onChangeText={setEmail}
          style={styles.input}
          value={email}
        />
      </Field>
      <View style={styles.autoNumberNote}>
        <Ionicons name="sparkles-outline" size={17} color={colors.gold} />
        <Text style={styles.autoNumberText}>Nomor karyawan dibuat otomatis setelah akun disimpan.</Text>
      </View>
      <Field label="Jabatan">
        <TextInput
          accessibilityLabel="Jabatan akun baru"
          autoCapitalize="words"
          onChangeText={setJobTitle}
          style={styles.input}
          value={jobTitle}
        />
      </Field>
      <Field label="Kata sandi awal">
        <View style={styles.passwordRow}>
          <TextInput
            accessibilityLabel="Kata sandi awal akun baru"
            autoCapitalize="none"
            autoComplete="new-password"
            onChangeText={setPassword}
            secureTextEntry={!passwordVisible}
            style={styles.passwordInput}
            value={password}
          />
          <Pressable
            accessibilityLabel={passwordVisible ? "Sembunyikan kata sandi" : "Tampilkan kata sandi"}
            accessibilityRole="button"
            onPress={() => setPasswordVisible((value) => !value)}
            style={styles.eyeButton}
          >
            <Ionicons
              name={passwordVisible ? "eye-off-outline" : "eye-outline"}
              size={20}
              color={colors.inkMuted}
            />
          </Pressable>
        </View>
      </Field>
      <Text style={styles.passwordHelp}>Minimum 8 karakter.</Text>
      <Field label="Ulangi kata sandi">
        <TextInput
          accessibilityLabel="Konfirmasi kata sandi akun baru"
          autoCapitalize="none"
          autoComplete="new-password"
          onChangeText={setPasswordConfirmation}
          secureTextEntry={!passwordVisible}
          style={styles.input}
          value={passwordConfirmation}
        />
      </Field>
      {accountRole === "EMPLOYEE" ? (
        <View style={styles.pinSection}>
          <View style={styles.pinHeading}><Ionicons name="keypad-outline" size={18} color={colors.gold} /><View><Text style={styles.pinTitle}>PIN absensi kiosk</Text><Text style={styles.pinCopy}>Enam angka pribadi untuk absen di HP showroom.</Text></View></View>
          <View style={styles.twoColumns}>
            <View style={styles.column}><Field label="PIN 6 angka"><TextInput accessibilityLabel="PIN absensi akun baru" keyboardType="number-pad" maxLength={6} secureTextEntry onChangeText={(value) => setKioskPIN(value.replace(/\D/g, ""))} style={styles.input} value={kioskPIN} /></Field></View>
            <View style={styles.column}><Field label="Ulangi PIN"><TextInput accessibilityLabel="Konfirmasi PIN absensi akun baru" keyboardType="number-pad" maxLength={6} secureTextEntry onChangeText={(value) => setKioskPINConfirmation(value.replace(/\D/g, ""))} style={styles.input} value={kioskPINConfirmation} /></Field></View>
          </View>
        </View>
      ) : null}

      {error ? (
        <Text accessibilityLiveRegion="assertive" accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      ) : null}
      {notice ? (
        <Text accessibilityLiveRegion="polite" style={styles.notice}>
          {notice}
        </Text>
      ) : null}
      <Pressable
        accessibilityRole="button"
        disabled={saving}
        onPress={() => void submit()}
        style={({ pressed }) => [
          styles.submit,
          pressed && styles.submitPressed,
          saving && styles.submitDisabled,
        ]}
      >
        <Text style={styles.submitText}>
          {saving
            ? "Menyimpan…"
            : accountRole === "SUPERVISOR"
              ? "Buat akun supervisor"
              : "Buat akun karyawan"}
        </Text>
      </Pressable>
    </View>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: spacing.xl,
    padding: spacing.lg,
    backgroundColor: "#F9F5EA",
    borderTopWidth: 3,
    borderColor: colors.gold,
  },
  kicker: { color: "#8A6C2D", fontSize: 10, fontWeight: "700", letterSpacing: 1.6 },
  title: { color: colors.espresso, fontFamily: "serif", fontSize: 24, marginTop: 5 },
  copy: { color: colors.inkMuted, lineHeight: 20, marginTop: 6 },
  rolePicker: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.lg },
  roleOption: { flex: 1, minHeight: 46, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.line, backgroundColor: colors.paper },
  roleOptionSelected: { backgroundColor: colors.espresso, borderColor: colors.espresso },
  roleText: { color: colors.inkMuted, fontWeight: "700" },
  roleTextSelected: { color: colors.goldSoft },
  fixedRole: { minHeight: 46, flexDirection: "row", alignItems: "center", gap: spacing.sm, borderBottomWidth: 1, borderColor: colors.line, marginTop: spacing.md },
  fixedRoleText: { color: colors.espresso, fontWeight: "700" },
  autoNumberNote: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.md, padding: spacing.md, backgroundColor: "#F3EAD5", borderLeftWidth: 3, borderLeftColor: colors.gold },
  autoNumberText: { flex: 1, color: colors.inkMuted, fontSize: 12, lineHeight: 18 },
  field: { marginTop: spacing.md },
  label: { color: colors.inkMuted, fontSize: 11, fontWeight: "600", marginBottom: 7 },
  input: { minHeight: 48, borderWidth: 1, borderColor: "#CFC5AF", backgroundColor: colors.paper, color: colors.espresso, paddingHorizontal: spacing.md },
  twoColumns: { flexDirection: "row", gap: spacing.sm },
  column: { flex: 1, minWidth: 0 },
  passwordRow: { minHeight: 48, flexDirection: "row", alignItems: "center", borderWidth: 1, borderColor: "#CFC5AF", backgroundColor: colors.paper },
  passwordInput: { flex: 1, minHeight: 46, color: colors.espresso, paddingLeft: spacing.md },
  eyeButton: { width: 48, minHeight: 46, alignItems: "center", justifyContent: "center" },
  passwordHelp: { color: colors.inkMuted, fontSize: 10, marginTop: 5 },
  pinSection: { marginTop: spacing.lg, padding: spacing.md, backgroundColor: colors.paper, borderWidth: 1, borderColor: colors.line },
  pinHeading: { flexDirection: "row", alignItems: "center", gap: 10 },
  pinTitle: { color: colors.espresso, fontWeight: "800" },
  pinCopy: { color: colors.inkMuted, fontSize: 10, marginTop: 2 },
  error: { color: colors.ruby, fontSize: 12, lineHeight: 18, marginTop: spacing.md },
  notice: { color: colors.emerald, fontSize: 12, lineHeight: 18, marginTop: spacing.md },
  submit: { minHeight: 52, alignItems: "center", justifyContent: "center", backgroundColor: colors.gold, marginTop: spacing.lg, paddingHorizontal: spacing.md },
  submitPressed: { opacity: 0.84 },
  submitDisabled: { opacity: 0.6 },
  submitText: { color: colors.espresso, fontWeight: "800" },
});
