import { Ionicons } from "@expo/vector-icons";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type ImageSourcePropType,
} from "react-native";
import { actionLabel } from "../lib/attendance";
import {
  api,
  privateApiImageSource,
  type AttendanceEvent,
  type AttendanceEvidenceDetail,
} from "../lib/api";
import { demoEvidenceImage } from "../lib/demoEvidence";
import { formatInstant } from "../lib/timezone";
import { colors, radius, spacing } from "../theme";

export function AttendanceEvidenceModal({
  event,
  onClose,
  timezone,
  token,
}: {
  event: AttendanceEvent | null;
  onClose(): void;
  timezone: string;
  token: string;
}) {
  const [detail, setDetail] = useState<AttendanceEvidenceDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [imageError, setImageError] = useState("");

  useEffect(() => {
    let active = true;
    setDetail(null);
    setError("");
    setImageError("");
    if (!event) return () => undefined;
    setLoading(true);
    void api
      .myAttendanceEvidence(token, event.id)
      .then((value) => {
        if (active) setDetail(value);
      })
      .catch((cause) => {
        if (active) {
          setError(
            cause instanceof Error
              ? cause.message
              : "Detail absensi belum dapat dimuat.",
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [event, token]);

  const imageSource = useMemo<ImageSourcePropType | undefined>(() => {
    const url = detail?.attachment?.url;
    return url
      ? (demoEvidenceImage(url) ?? privateApiImageSource(url, token))
      : undefined;
  }, [detail?.attachment?.url, token]);
  const recordedAt = detail?.recordedAt ?? event?.recordedAt;
  const decision = detail?.decision ?? event?.decision;

  async function openMap() {
    if (!detail?.location) return;
    await Linking.openURL(
      `https://www.google.com/maps/search/?api=1&query=${detail.location.latitude},${detail.location.longitude}`,
    );
  }

  return (
    <Modal
      animationType="slide"
      onRequestClose={onClose}
      transparent
      visible={Boolean(event)}
    >
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <View style={styles.headerCopy}>
              <Text style={styles.eyebrow}>DETAIL ABSENSI ANDA</Text>
              <Text style={styles.title}>
                {event ? actionLabel(event.actionType) : "Absensi"}
              </Text>
            </View>
            <Pressable
              accessibilityLabel="Tutup detail absensi"
              accessibilityRole="button"
              onPress={onClose}
              style={styles.close}
            >
              <Ionicons name="close" size={23} color={colors.espresso} />
            </Pressable>
          </View>
          <ScrollView
            contentContainerStyle={styles.content}
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.summary}>
              <View style={styles.summaryIcon}>
                <Ionicons name="finger-print-outline" size={23} color={colors.gold} />
              </View>
              <View style={styles.summaryCopy}>
                <Text style={styles.summaryLabel}>WAKTU SERVER</Text>
                <Text style={styles.summaryTime}>
                  {recordedAt
                    ? formatInstant(new Date(recordedAt), timezone, {
                        weekday: "long",
                        day: "numeric",
                        month: "long",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })
                    : "—"}
                </Text>
              </View>
              <Text
                style={[
                  styles.status,
                  decision === "APPROVED"
                    ? styles.approved
                    : decision === "REJECTED"
                      ? styles.rejected
                      : styles.pending,
                ]}
              >
                {decision === "APPROVED"
                  ? "TERCATAT"
                  : decision === "REJECTED"
                    ? "DITOLAK"
                    : "MENUNGGU"}
              </Text>
            </View>

            {loading ? (
              <View style={styles.loading}>
                <ActivityIndicator color={colors.gold} />
                <Text style={styles.muted}>Membuka bukti privat…</Text>
              </View>
            ) : null}
            {error ? (
              <View accessibilityRole="alert" style={styles.error}>
                <Ionicons name="alert-circle-outline" size={20} color={colors.ruby} />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null}

            {imageSource ? (
              <View style={styles.photoCard}>
                <Image
                  accessibilityLabel="Foto bukti absensi Anda"
                  onError={() => setImageError("Foto selfie belum dapat dimuat. Coba buka detail ini kembali.")}
                  onLoad={() => setImageError("")}
                  resizeMode="cover"
                  source={imageSource}
                  style={styles.photo}
                />
                {imageError ? (
                  <View accessibilityRole="alert" style={styles.photoError}>
                    <Ionicons name="image-outline" size={18} color={colors.ruby} />
                    <Text style={styles.errorText}>{imageError}</Text>
                  </View>
                ) : null}
                <View style={styles.photoCaption}>
                  <Text style={styles.photoTitle}>SELFIE ABSENSI</Text>
                  <View style={styles.privateBadge}>
                    <Ionicons name="lock-closed" size={12} color={colors.emerald} />
                    <Text style={styles.privateText}>PRIVAT</Text>
                  </View>
                </View>
              </View>
            ) : !loading && detail ? (
              <View style={styles.emptyEvidence}>
                <Ionicons name="image-outline" size={24} color={colors.inkMuted} />
                <Text style={styles.muted}>Absensi ini tidak memiliki lampiran foto.</Text>
              </View>
            ) : null}

            {detail ? (
              <>
                <Text style={styles.sectionTitle}>LOKASI SAAT ABSEN</Text>
                <View style={styles.detailCard}>
                  <View style={styles.detailHeading}>
                    <Ionicons name="location" size={20} color={colors.gold} />
                    <View style={styles.detailHeadingCopy}>
                      <Text style={styles.detailTitle}>
                        {detail.section?.name ?? "Lokasi tidak tercatat"}
                      </Text>
                      {detail.section?.address ? (
                        <Text style={styles.muted}>{detail.section.address}</Text>
                      ) : null}
                    </View>
                  </View>
                  {detail.location ? (
                    <>
                      <Text style={styles.coordinates}>
                        {detail.location.latitude.toFixed(6)}, {detail.location.longitude.toFixed(6)}
                        {detail.location.accuracyM !== undefined
                          ? ` · akurasi ±${Math.round(detail.location.accuracyM)} m`
                          : ""}
                      </Text>
                      <Pressable
                        accessibilityRole="button"
                        onPress={() => void openMap()}
                        style={styles.mapButton}
                      >
                        <Ionicons name="map-outline" size={17} color={colors.white} />
                        <Text style={styles.mapText}>Buka di peta</Text>
                      </Pressable>
                    </>
                  ) : (
                    <Text style={styles.muted}>Koordinat tidak tersedia.</Text>
                  )}
                </View>

                <Text style={styles.sectionTitle}>BUKTI PERANGKAT</Text>
                <View style={styles.facts}>
                  <Fact label="Sumber" value={sourceLabel(detail.source)} />
                  <Fact
                    label="Perangkat"
                    value={detail.device?.label ?? detail.device?.platform ?? "Tidak tersedia"}
                  />
                  <Fact label="Wi-Fi" value={detail.wifiSSID ?? "Tidak direkam"} />
                  <Fact
                    label="Verifikasi wajah"
                    value={
                      detail.faceVerification
                        ? detail.faceVerification.verified
                          ? `Cocok · ${Math.round(detail.faceVerification.similarityScore * 100)}%`
                          : "Tidak cocok"
                        : "Tidak digunakan"
                    }
                  />
                </View>
                {detail.reason ? (
                  <View style={styles.reason}>
                    <Text style={styles.sectionTitle}>CATATAN</Text>
                    <Text style={styles.reasonText}>{detail.reason}</Text>
                  </View>
                ) : null}
              </>
            ) : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.fact}>
      <Text style={styles.factLabel}>{label}</Text>
      <Text style={styles.factValue}>{value}</Text>
    </View>
  );
}

function sourceLabel(source: string) {
  return source === "MOBILE" ? "Aplikasi Android" : source.replaceAll("_", " ");
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(24, 12, 8, 0.48)" },
  sheet: {
    maxHeight: "94%",
    minHeight: "58%",
    backgroundColor: colors.ivory,
    borderTopLeftRadius: radius.panel,
    borderTopRightRadius: radius.panel,
    overflow: "hidden",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderColor: colors.line,
  },
  headerCopy: { flex: 1 },
  eyebrow: { color: "#8A6C2D", fontSize: 9, fontWeight: "800", letterSpacing: 1.5 },
  title: { color: colors.espresso, fontFamily: "serif", fontSize: 27, marginTop: 4 },
  close: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  content: { padding: spacing.lg, paddingBottom: 64 },
  summary: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  summaryIcon: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: colors.ivoryDeep },
  summaryCopy: { flex: 1 },
  summaryLabel: { color: colors.inkMuted, fontSize: 9, fontWeight: "700", letterSpacing: 1 },
  summaryTime: { color: colors.espresso, fontSize: 13, fontWeight: "700", marginTop: 4, lineHeight: 18 },
  status: { fontSize: 9, fontWeight: "800", paddingHorizontal: 8, paddingVertical: 6, borderRadius: 10 },
  approved: { color: colors.emerald, backgroundColor: "#E4F2E9" },
  pending: { color: "#7D5D18", backgroundColor: "#F7EDCF" },
  rejected: { color: colors.ruby, backgroundColor: "#FBEFEF" },
  loading: { alignItems: "center", gap: spacing.sm, paddingVertical: spacing.xl },
  error: { flexDirection: "row", gap: spacing.sm, padding: spacing.md, marginTop: spacing.lg, backgroundColor: "#FBEFEF", borderLeftWidth: 3, borderColor: colors.ruby },
  errorText: { flex: 1, color: colors.ruby, lineHeight: 19 },
  photoCard: { marginTop: spacing.lg, backgroundColor: colors.paper, borderRadius: radius.panel, overflow: "hidden", borderWidth: 1, borderColor: colors.line },
  photo: { width: "100%", height: 330, backgroundColor: colors.ivoryDeep },
  photoError: { flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.md, backgroundColor: "#FBEFEF" },
  photoCaption: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: spacing.md },
  photoTitle: { color: colors.espresso, fontSize: 10, fontWeight: "800", letterSpacing: 1.2 },
  privateBadge: { flexDirection: "row", alignItems: "center", gap: 4 },
  privateText: { color: colors.emerald, fontSize: 9, fontWeight: "800" },
  emptyEvidence: { flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.lg, marginTop: spacing.lg, backgroundColor: colors.ivoryDeep },
  muted: { color: colors.inkMuted, fontSize: 12, lineHeight: 18 },
  sectionTitle: { color: "#8A6C2D", fontSize: 9, fontWeight: "800", letterSpacing: 1.3, marginTop: spacing.xl, marginBottom: spacing.sm },
  detailCard: { padding: spacing.md, backgroundColor: colors.paper, borderWidth: 1, borderColor: colors.line, borderRadius: radius.control },
  detailHeading: { flexDirection: "row", gap: spacing.sm },
  detailHeadingCopy: { flex: 1 },
  detailTitle: { color: colors.espresso, fontWeight: "700", marginBottom: 3 },
  coordinates: { color: colors.inkMuted, fontSize: 11, marginTop: spacing.md },
  mapButton: { alignSelf: "flex-start", minHeight: 44, marginTop: spacing.md, paddingHorizontal: spacing.md, flexDirection: "row", alignItems: "center", gap: 7, backgroundColor: colors.espresso, borderRadius: radius.control },
  mapText: { color: colors.white, fontSize: 12, fontWeight: "700" },
  facts: { backgroundColor: colors.paper, borderWidth: 1, borderColor: colors.line, borderRadius: radius.control, overflow: "hidden" },
  fact: { flexDirection: "row", gap: spacing.md, padding: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.line },
  factLabel: { width: 104, color: colors.inkMuted, fontSize: 11 },
  factValue: { flex: 1, color: colors.espresso, fontSize: 12, fontWeight: "600", textAlign: "right" },
  reason: { marginTop: spacing.sm },
  reasonText: { color: colors.espresso, lineHeight: 21, padding: spacing.md, backgroundColor: colors.ivoryDeep },
});
