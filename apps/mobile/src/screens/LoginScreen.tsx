import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Screen } from "../components/Screen";
import { TutorialLauncher } from "../components/GuidedTutorial";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import type { DemoRole } from "../lib/demoSession";
import { colors, radius, spacing } from "../theme";

type Mode = "login" | "forgot" | "reset";

export function LoginScreen() {
  const { enterDemo, login } = useAuth();
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [resetToken, setResetToken] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  useEffect(() => {
    let active = true;
    const openResetLink = (url: string | null) => {
      if (!active || !url) return;
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        return;
      }
      const isReset =
        parsed.hostname === "reset-password" ||
        parsed.pathname.replace(/^\//, "") === "reset-password";
      const token = parsed.searchParams.get("token");
      if (isReset && token?.trim()) {
        setResetToken(token);
        setMode("reset");
        setError("");
        setMessage("Tautan reset diterima. Buat kata sandi baru Anda.");
      }
    };
    void Linking.getInitialURL().then(openResetLink);
    const subscription = Linking.addEventListener("url", (event) =>
      openResetLink(event.url),
    );
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);
  const submitDisabled =
    loading ||
    (mode !== "reset" && !email.trim()) ||
    (mode === "login" && !password) ||
    (mode === "reset" &&
      (!resetToken.trim() || password.length < 12 || !confirmation));

  function changeMode(next: Mode) {
    setMode(next);
    setError("");
    setMessage("");
  }

  async function submitLogin() {
    setLoading(true);
    setError("");
    try {
      await login(email.trim(), password);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Tidak dapat masuk.");
    } finally {
      setLoading(false);
    }
  }

  async function startDemo(role: DemoRole) {
    setLoading(true);
    setError("");
    try {
      await enterDemo(role);
    } catch {
      setError("Mode demo belum dapat disiapkan di perangkat ini.");
    } finally {
      setLoading(false);
    }
  }

  async function requestReset() {
    setLoading(true);
    setError("");
    setMessage("");
    try {
      const result = await api.forgotPassword(email.trim());
      setMessage(result.message);
      if (result.developmentResetToken) {
        setResetToken(result.developmentResetToken);
        setMode("reset");
      }
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Permintaan reset belum dapat dikirim.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function submitReset() {
    if (password !== confirmation) {
      setError("Konfirmasi kata sandi belum sama.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const result = await api.resetPassword(resetToken.trim(), password);
      setPassword("");
      setConfirmation("");
      setResetToken("");
      setMode("login");
      setMessage(result.message);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Kata sandi belum dapat diperbarui.",
      );
    } finally {
      setLoading(false);
    }
  }

  function submit() {
    if (mode === "login") return submitLogin();
    if (mode === "forgot") return requestReset();
    return submitReset();
  }

  const loginIntroRef = useRef<View>(null);
  const loginChoicesRef = useRef<View>(null);
  return (
    <Screen>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.root}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View ref={loginIntroRef} collapsable={false} style={styles.brand}>
            <Image
              source={require("../../assets/bg-gold-logo.png")}
              resizeMode="contain"
              style={styles.logo}
            />
            <Text style={styles.product}>Attendance</Text>
          </View>
          <View style={styles.intro}>
            <Text style={styles.eyebrow}>RUANG KERJA BG GOLD</Text>
            <Text style={styles.title}>
              {mode === "login"
                ? "Mulai hari kerja dengan jelas."
                : mode === "forgot"
                  ? "Pulihkan akses Anda."
                  : "Buat kata sandi baru."}
            </Text>
            <Text style={styles.copy}>
              {mode === "login"
                ? "Masuk untuk melihat jadwal dan mencatat kehadiran Anda."
                : mode === "forgot"
                  ? "Masukkan email akun. Kami akan mengirim petunjuk bila akun ditemukan."
                  : "Gunakan token dari petunjuk reset dan pilih kata sandi minimal 12 karakter."}
            </Text>
          </View>
          <View ref={loginChoicesRef} collapsable={false} style={styles.form}>
            {mode !== "reset" ? (
              <>
                <Text style={styles.label}>Email</Text>
                <TextInput
                  accessibilityLabel="Email"
                  autoCapitalize="none"
                  autoComplete="email"
                  keyboardType="email-address"
                  value={email}
                  onChangeText={setEmail}
                  style={styles.input}
                />
              </>
            ) : (
              <>
                <Text style={styles.label}>Token reset</Text>
                <TextInput
                  accessibilityLabel="Token reset"
                  autoCapitalize="none"
                  value={resetToken}
                  onChangeText={setResetToken}
                  style={styles.input}
                />
              </>
            )}
            {mode !== "forgot" ? (
              <>
                <Text style={styles.label}>
                  {mode === "login" ? "Kata sandi" : "Kata sandi baru"}
                </Text>
                <TextInput
                  accessibilityLabel={
                    mode === "login" ? "Kata sandi" : "Kata sandi baru"
                  }
                  autoComplete={
                    mode === "login" ? "current-password" : "new-password"
                  }
                  secureTextEntry
                  value={password}
                  onChangeText={setPassword}
                  style={styles.input}
                />
              </>
            ) : null}
            {mode === "reset" ? (
              <>
                <Text style={styles.label}>Ulangi kata sandi baru</Text>
                <TextInput
                  accessibilityLabel="Ulangi kata sandi baru"
                  autoComplete="new-password"
                  secureTextEntry
                  value={confirmation}
                  onChangeText={setConfirmation}
                  style={styles.input}
                />
              </>
            ) : null}
            {message ? <Text style={styles.success}>{message}</Text> : null}
            {error ? (
              <Text accessibilityRole="alert" style={styles.error}>
                {error}
              </Text>
            ) : null}
            <Pressable
              accessibilityRole="button"
              disabled={submitDisabled}
              onPress={() => void submit()}
              style={({ pressed }) => [
                styles.button,
                pressed && styles.pressed,
                submitDisabled && styles.disabled,
              ]}
            >
              {loading ? (
                <ActivityIndicator color={colors.white} />
              ) : (
                <Text style={styles.buttonText}>
                  {mode === "login"
                    ? "Masuk"
                    : mode === "forgot"
                      ? "Kirim petunjuk"
                      : "Perbarui kata sandi"}
                </Text>
              )}
            </Pressable>
            {mode === "login" ? (
              <>
                <View style={styles.demoDivider}>
                  <View style={styles.demoRule} />
                  <Text style={styles.demoOr}>ATAU</Text>
                  <View style={styles.demoRule} />
                </View>
                <View style={styles.demoIntro}>
                  <Text style={styles.demoHeading}>PILIH PERAN DEMO</Text>
                  <Text style={styles.demoIntroText}>
                    Setiap peran memakai data contoh lokal yang aman untuk
                    dicoba.
                  </Text>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Coba demo tanpa server"
                  accessibilityHint="Membuka contoh aplikasi untuk karyawan yang tersimpan hanya di perangkat"
                  disabled={loading}
                  onPress={() => void startDemo("employee")}
                  style={({ pressed }) => [
                    styles.demoButton,
                    pressed && styles.pressed,
                  ]}
                >
                  <View style={styles.demoIcon}>
                    <Ionicons
                      name="sparkles-outline"
                      size={20}
                      color={colors.gold}
                    />
                  </View>
                  <View style={styles.demoCopy}>
                    <Text style={styles.demoButtonText}>Demo karyawan</Text>
                    <Text style={styles.demoCaption}>
                      Absensi, jadwal, cuti, dan klaim
                    </Text>
                  </View>
                  <Ionicons
                    name="chevron-forward"
                    size={19}
                    color={colors.espresso}
                  />
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Coba demo supervisor tanpa server"
                  accessibilityHint="Membuka contoh antrean persetujuan supervisor yang tersimpan hanya di perangkat"
                  disabled={loading}
                  onPress={() => void startDemo("supervisor")}
                  style={({ pressed }) => [
                    styles.demoButton,
                    styles.supervisorDemoButton,
                    pressed && styles.pressed,
                  ]}
                >
                  <View style={[styles.demoIcon, styles.supervisorDemoIcon]}>
                    <Ionicons
                      name="checkmark-done-outline"
                      size={20}
                      color={colors.goldSoft}
                    />
                  </View>
                  <View style={styles.demoCopy}>
                    <Text style={styles.demoButtonText}>Demo supervisor</Text>
                    <Text style={styles.demoCaption}>
                      Kelola tim, showroom, dan aktifkan kiosk 1 HP
                    </Text>
                  </View>
                  <Ionicons
                    name="chevron-forward"
                    size={19}
                    color={colors.espresso}
                  />
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => changeMode("forgot")}
                  style={styles.secondaryAction}
                >
                  <Text style={styles.secondaryText}>Lupa kata sandi?</Text>
                </Pressable>
              </>
            ) : (
              <View style={styles.secondaryRow}>
                {mode === "forgot" && message ? (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => changeMode("reset")}
                    style={styles.secondaryAction}
                  >
                    <Text style={styles.secondaryText}>Saya punya token</Text>
                  </Pressable>
                ) : null}
                <Pressable
                  accessibilityRole="button"
                  onPress={() => changeMode("login")}
                  style={styles.secondaryAction}
                >
                  <Text style={styles.secondaryText}>Kembali ke login</Text>
                </Pressable>
              </View>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
      <TutorialLauncher
        accessibilityLabel="Buka tutorial Login"
        steps={[
          {
            target: loginIntroRef,
            title: "Selamat datang di Absen BG",
            body: "Gunakan akun yang telah dibuat supervisor atau superadmin untuk masuk ke ruang kerja organisasi Anda.",
          },
          {
            target: loginChoicesRef,
            title: "Masuk atau coba mode demo",
            body: "Isi email dan kata sandi lalu ketuk Masuk. Untuk mencoba kiosk satu HP tanpa server, masuk ke Demo supervisor lalu aktifkan kiosk dari menu Profil.",
          },
        ]}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    padding: spacing.lg,
    justifyContent: "space-between",
  },
  brand: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  logo: { width: 70, height: 42 },
  product: {
    fontFamily: Platform.select({ ios: "Georgia", android: "serif" }),
    fontSize: 19,
    color: colors.espresso,
  },
  intro: { marginTop: spacing.xxl },
  eyebrow: {
    fontSize: 11,
    letterSpacing: 2,
    color: colors.gold,
    fontWeight: "700",
  },
  title: {
    fontFamily: Platform.select({ ios: "Georgia", android: "serif" }),
    fontSize: 44,
    lineHeight: 50,
    color: colors.espresso,
    marginTop: spacing.sm,
    maxWidth: 340,
  },
  copy: {
    fontSize: 16,
    lineHeight: 24,
    color: colors.inkMuted,
    marginTop: spacing.md,
    maxWidth: 350,
  },
  form: { gap: spacing.sm, paddingBottom: spacing.lg },
  label: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.espresso,
    marginTop: spacing.sm,
  },
  input: {
    minHeight: 52,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.field,
    backgroundColor: colors.paper,
    paddingHorizontal: spacing.md,
    fontSize: 16,
    color: colors.espresso,
  },
  error: { color: colors.ruby, fontSize: 13, lineHeight: 18 },
  success: {
    color: colors.emerald,
    borderLeftWidth: 3,
    borderColor: colors.emerald,
    paddingLeft: spacing.sm,
    fontSize: 13,
    lineHeight: 18,
  },
  button: {
    minHeight: 54,
    paddingVertical: spacing.sm,
    borderRadius: radius.control,
    backgroundColor: colors.espresso,
    alignItems: "center",
    justifyContent: "center",
    marginTop: spacing.md,
  },
  buttonText: { color: colors.white, fontWeight: "700", fontSize: 16 },
  pressed: {
    elevation: 1,
    opacity: 0.94,
    shadowOpacity: 0.07,
    transform: [{ translateY: 2 }, { scale: 0.99 }],
  },
  disabled: { opacity: 0.55 },
  secondaryAction: {
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.sm,
  },
  secondaryText: { color: "#76591E", fontWeight: "700", fontSize: 13 },
  secondaryRow: { flexDirection: "row", justifyContent: "space-between" },
  demoDivider: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  demoRule: { flex: 1, height: 1, backgroundColor: colors.line },
  demoOr: { fontSize: 9, letterSpacing: 1.5, color: colors.inkMuted },
  demoIntro: { gap: 3 },
  demoHeading: {
    color: "#8A6C2D",
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 1.4,
  },
  demoIntroText: { color: colors.inkMuted, fontSize: 11, lineHeight: 16 },
  demoButton: {
    minHeight: 76,
    borderWidth: 1,
    borderColor: colors.gold,
    borderRadius: radius.panel,
    backgroundColor: colors.paper,
    elevation: 4,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    shadowColor: colors.espresso,
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.12,
    shadowRadius: 10,
  },
  demoIcon: {
    flexShrink: 0,
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F7EFCF",
    borderRadius: 14,
  },
  demoCopy: { flex: 1, minWidth: 0 },
  demoButtonText: { color: colors.espresso, fontWeight: "700", fontSize: 15 },
  demoCaption: {
    color: colors.inkMuted,
    fontSize: 11,
    lineHeight: 16,
    marginTop: 3,
  },
  supervisorDemoButton: { borderColor: colors.espresso },
  supervisorDemoIcon: { backgroundColor: colors.espresso },
  deviceDemoButton: {
    backgroundColor: "#F3F0E8",
    borderColor: colors.emerald,
  },
  deviceDemoIcon: { backgroundColor: colors.emerald },
  demoTitleRow: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 7,
  },
  demoBadge: {
    backgroundColor: "#E3F1E8",
    color: colors.emerald,
    fontSize: 8,
    fontWeight: "900",
    letterSpacing: 1,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 999,
  },
});
