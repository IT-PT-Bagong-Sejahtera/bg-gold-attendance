import { Ionicons } from "@expo/vector-icons";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { api, type Section, type SectionPayload } from "../lib/api";
import { colors, radius, spacing } from "../theme";

type FormState = {
  code: string;
  name: string;
  address: string;
  timezone: string;
};

export function ShowroomManagementCard({
  token,
  defaultTimezone,
}: {
  token: string;
  defaultTimezone: string;
}) {
  const [showrooms, setShowrooms] = useState<Section[]>([]);
  const [form, setForm] = useState<FormState | null>(null);
  const [editingId, setEditingId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [changingStatus, setChangingStatus] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      setShowrooms(await api.sections(token));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Master showroom belum dapat dimuat.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const orderedShowrooms = useMemo(
    () =>
      [...showrooms].sort((left, right) => {
        if (left.status !== right.status) return left.status === "ACTIVE" ? -1 : 1;
        return left.name.localeCompare(right.name, "id");
      }),
    [showrooms],
  );

  function startCreate() {
    setEditingId("");
    setForm({ code: "", name: "", address: "", timezone: defaultTimezone || "Asia/Jakarta" });
    setError("");
    setNotice("");
  }

  function startEdit(showroom: Section) {
    setEditingId(showroom.id);
    setForm({
      code: showroom.code,
      name: showroom.name,
      address: showroom.address ?? "",
      timezone: showroom.timezone ?? defaultTimezone ?? "Asia/Jakarta",
    });
    setError("");
    setNotice("");
  }

  async function save() {
    if (!form) return;
    const payload: SectionPayload = {
      code: form.code.trim().toUpperCase(),
      name: form.name.trim(),
      address: form.address.trim(),
      timezone: form.timezone.trim() || defaultTimezone || "Asia/Jakarta",
    };
    if (!payload.code || !payload.name) {
      setError("Kode dan nama showroom wajib diisi.");
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      if (editingId) {
        const previous = showrooms.find((item) => item.id === editingId);
        await api.updateSection(token, editingId, {
          ...payload,
          latitude: previous?.latitude,
          longitude: previous?.longitude,
        });
        setNotice("Perubahan showroom berhasil disimpan.");
      } else {
        await api.createSection(token, payload);
        setNotice("Showroom baru berhasil ditambahkan.");
      }
      setForm(null);
      setEditingId("");
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Showroom belum dapat disimpan.");
    } finally {
      setSaving(false);
    }
  }

  async function changeStatus(showroom: Section) {
    const nextStatus = showroom.status === "ACTIVE" ? "INACTIVE" : "ACTIVE";
    setChangingStatus(showroom.id);
    setError("");
    setNotice("");
    try {
      await api.setSectionStatus(token, showroom.id, nextStatus);
      setNotice(
        nextStatus === "ACTIVE"
          ? `${showroom.name} kembali aktif.`
          : `${showroom.name} dinonaktifkan dan tidak muncul pada pilihan jadwal baru.`,
      );
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Status showroom belum dapat diubah.");
    } finally {
      setChangingStatus("");
    }
  }

  return (
    <View style={styles.card}>
      <View style={styles.headingRow}>
        <View style={styles.headingCopy}>
          <Text style={styles.eyebrow}>OPERASIONAL</Text>
          <Text style={styles.title}>Master showroom</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Tambah showroom"
          onPress={startCreate}
          style={({ pressed }) => [styles.addButton, pressed && styles.pressed]}
        >
          <Ionicons name="add" size={20} color={colors.paper} />
        </Pressable>
      </View>
      <Text style={styles.copy}>
        Kelola lokasi yang digunakan supervisor saat membuat jadwal dan event.
      </Text>

      {notice ? <Text style={styles.notice}>{notice}</Text> : null}
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}

      {form ? (
        <View style={styles.form}>
          <Text style={styles.formTitle}>{editingId ? "Edit showroom" : "Showroom baru"}</Text>
          <Field
            label="KODE SHOWROOM"
            value={form.code}
            onChangeText={(code) => setForm((current) => current ? { ...current, code: code.toUpperCase() } : current)}
            autoCapitalize="characters"
          />
          <Field
            label="NAMA SHOWROOM"
            value={form.name}
            onChangeText={(name) => setForm((current) => current ? { ...current, name } : current)}
          />
          <Field
            label="ALAMAT"
            value={form.address}
            onChangeText={(address) => setForm((current) => current ? { ...current, address } : current)}
            multiline
          />
          <Field
            label="ZONA WAKTU"
            value={form.timezone}
            onChangeText={(timezone) => setForm((current) => current ? { ...current, timezone } : current)}
            autoCapitalize="none"
          />
          <View style={styles.formActions}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Batalkan showroom"
              disabled={saving}
              onPress={() => { setForm(null); setEditingId(""); setError(""); }}
              style={styles.cancelButton}
            >
              <Text style={styles.cancelText}>Batal</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Simpan showroom"
              disabled={saving}
              onPress={() => void save()}
              style={styles.saveButton}
            >
              {saving ? <ActivityIndicator color={colors.paper} /> : <Text style={styles.saveText}>Simpan</Text>}
            </Pressable>
          </View>
        </View>
      ) : null}

      {loading ? (
        <View style={styles.loading}><ActivityIndicator color={colors.gold} /></View>
      ) : (
        <View style={styles.list}>
          {orderedShowrooms.map((showroom) => {
            const active = showroom.status === "ACTIVE";
            return (
              <View key={showroom.id} style={styles.row}>
                <View style={[styles.icon, !active && styles.iconInactive]}>
                  <Ionicons name="storefront-outline" size={20} color={active ? colors.gold : colors.inkMuted} />
                </View>
                <View style={styles.rowCopy}>
                  <View style={styles.nameRow}>
                    <Text style={styles.name}>{showroom.name}</Text>
                    <Text style={[styles.status, active ? styles.statusActive : styles.statusInactive]}>
                      {active ? "AKTIF" : "NONAKTIF"}
                    </Text>
                  </View>
                  <Text style={styles.meta}>{showroom.code} · {showroom.timezone || defaultTimezone}</Text>
                  {showroom.address ? <Text style={styles.address}>{showroom.address}</Text> : null}
                  <View style={styles.rowActions}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Edit ${showroom.name}`}
                      onPress={() => startEdit(showroom)}
                      style={styles.textAction}
                    >
                      <Text style={styles.editText}>Edit</Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`${active ? "Nonaktifkan" : "Aktifkan"} ${showroom.name}`}
                      disabled={changingStatus === showroom.id}
                      onPress={() => void changeStatus(showroom)}
                      style={styles.textAction}
                    >
                      {changingStatus === showroom.id ? (
                        <ActivityIndicator size="small" color={colors.inkMuted} />
                      ) : (
                        <Text style={active ? styles.deactivateText : styles.activateText}>
                          {active ? "Nonaktifkan" : "Aktifkan"}
                        </Text>
                      )}
                    </Pressable>
                  </View>
                </View>
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

function Field({ label, ...props }: React.ComponentProps<typeof TextInput> & { label: string }) {
  return (
    <View style={styles.fieldGroup}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label.toLocaleLowerCase("id-ID")}
        placeholder=""
        placeholderTextColor={colors.inkMuted}
        style={[styles.input, props.multiline && styles.inputMultiline]}
        {...props}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { marginTop: spacing.xl, padding: spacing.lg, borderRadius: radius.panel, backgroundColor: colors.ivoryDeep },
  headingRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  headingCopy: { flex: 1, minWidth: 0 },
  eyebrow: { color: "#8A6C2D", fontSize: 9, fontWeight: "800", letterSpacing: 1.5 },
  title: { color: colors.espresso, fontFamily: "serif", fontSize: 24, marginTop: 3 },
  copy: { color: colors.inkMuted, lineHeight: 20, marginTop: spacing.sm },
  addButton: { width: 46, height: 46, borderRadius: 23, backgroundColor: colors.espresso, alignItems: "center", justifyContent: "center" },
  pressed: { opacity: 0.72 },
  notice: { color: colors.emerald, fontSize: 12, lineHeight: 18, marginTop: spacing.md },
  error: { color: colors.ruby, fontSize: 12, lineHeight: 18, marginTop: spacing.md },
  form: { marginTop: spacing.lg, padding: spacing.md, borderRadius: radius.control, backgroundColor: colors.paper, borderWidth: 1, borderColor: colors.line },
  formTitle: { fontFamily: "serif", fontSize: 20, color: colors.espresso, marginBottom: spacing.sm },
  fieldGroup: { marginTop: spacing.md },
  label: { color: "#8A6C2D", fontSize: 9, fontWeight: "800", letterSpacing: 1.2, marginBottom: spacing.xs },
  input: { minHeight: 50, borderBottomWidth: 1, borderColor: colors.line, color: colors.espresso, fontSize: 15, paddingHorizontal: 0, paddingVertical: spacing.sm },
  inputMultiline: { minHeight: 72, textAlignVertical: "top" },
  formActions: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.lg },
  cancelButton: { flex: 1, minHeight: 48, borderWidth: 1, borderColor: colors.line, borderRadius: radius.control, alignItems: "center", justifyContent: "center" },
  cancelText: { color: colors.inkMuted, fontWeight: "700" },
  saveButton: { flex: 1.35, minHeight: 48, borderRadius: radius.control, backgroundColor: colors.espresso, alignItems: "center", justifyContent: "center" },
  saveText: { color: colors.paper, fontWeight: "800" },
  loading: { minHeight: 110, alignItems: "center", justifyContent: "center" },
  list: { marginTop: spacing.md },
  row: { flexDirection: "row", gap: spacing.md, paddingVertical: spacing.md, borderTopWidth: 1, borderColor: colors.line },
  icon: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.paper, alignItems: "center", justifyContent: "center" },
  iconInactive: { opacity: 0.7 },
  rowCopy: { flex: 1, minWidth: 0 },
  nameRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  name: { flex: 1, color: colors.espresso, fontWeight: "800", fontSize: 15 },
  status: { overflow: "hidden", borderRadius: 99, paddingHorizontal: 8, paddingVertical: 3, fontSize: 8, fontWeight: "900", letterSpacing: 0.6 },
  statusActive: { color: colors.emerald, backgroundColor: "#E4F2EC" },
  statusInactive: { color: colors.inkMuted, backgroundColor: colors.paper },
  meta: { color: "#8A6C2D", fontSize: 10, fontWeight: "700", marginTop: 5 },
  address: { color: colors.inkMuted, fontSize: 12, lineHeight: 18, marginTop: 3 },
  rowActions: { flexDirection: "row", gap: spacing.lg, marginTop: spacing.sm },
  textAction: { minHeight: 36, justifyContent: "center" },
  editText: { color: colors.brown, fontWeight: "800", fontSize: 12 },
  deactivateText: { color: colors.ruby, fontWeight: "700", fontSize: 12 },
  activateText: { color: colors.emerald, fontWeight: "800", fontSize: 12 },
});
