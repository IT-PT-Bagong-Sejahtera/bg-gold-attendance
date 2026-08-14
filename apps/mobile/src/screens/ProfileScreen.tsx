import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Screen } from "../components/Screen";
import { LoadingRows } from "../components/LoadingRows";
import { AccountRegistrationCard } from "../components/AccountRegistrationCard";
import { ShowroomManagementCard } from "../components/ShowroomManagementCard";
import { TutorialLauncher } from "../components/GuidedTutorial";
import { api, type Me, type Organization } from "../lib/api";
import { useAuth } from "../lib/auth";
import { colors, spacing } from "../theme";

export function ProfileScreen() {
  const auth = useAuth();
  const token = auth.session!.accessToken;
  const [me, setMe] = useState<Me | null>(null);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [error, setError] = useState("");
  const [switching, setSwitching] = useState("");
  const [faceSaving, setFaceSaving] = useState(false);
  const [faceNotice, setFaceNotice] = useState("");
  const [demoNotice, setDemoNotice] = useState("");
  const load = useCallback(async () => {
    setError("");
    const [identity, availableOrganizations] = await Promise.all([
      api.me(token),
      api.organizations(token),
    ]);
    setMe(identity);
    setOrganizations(availableOrganizations);
  }, [token]);
  useEffect(() => {
    let active = true;
    void load()
      .catch((reason) => {
        if (active)
          setError(
            reason instanceof Error
              ? reason.message
              : "Profil belum dapat dimuat.",
          );
      });
    return () => {
      active = false;
    };
  }, [load]);
  const activeOrganization = organizations.find(
    (organization) => organization.id === me?.organizationId,
  );
  async function chooseOrganization(organizationId: string) {
    setSwitching(organizationId);
    setError("");
    try {
      await auth.switchOrganization(organizationId);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Organisasi belum dapat diganti.",
      );
    } finally {
      setSwitching("");
    }
  }
  async function enrollFace() {
    setFaceSaving(true); setError(""); setFaceNotice("");
    try {
      const permission=await ImagePicker.requestCameraPermissionsAsync();if(!permission.granted)throw new Error("Izin kamera diperlukan untuk mendaftarkan wajah.");
      const result=await ImagePicker.launchCameraAsync({cameraType:ImagePicker.CameraType.front,quality:.8,allowsEditing:true,aspect:[3,4]});if(result.canceled)return;const asset=result.assets[0];if(!asset)return;
      const image=await api.faceImage(token,asset.uri,asset.mimeType??"image/jpeg");await api.enrollFace(token,image.id);setFaceNotice("Wajah berhasil didaftarkan untuk verifikasi absensi.");
    } catch(reason){setError(reason instanceof Error?reason.message:"Wajah belum dapat didaftarkan.");}
    finally{setFaceSaving(false);}
  }
  const identityRef = useRef<View>(null);
  const securityRef = useRef<View>(null);
  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.eyebrow}>PROFIL</Text>
        <Text style={styles.title}>Akun & organisasi</Text>
        <View style={styles.rule} />
        {!me && !error ? (
          <LoadingRows label="Memuat profil dan organisasi" count={2} />
        ) : null}
        {error ? <View accessibilityRole="alert" accessibilityLiveRegion="assertive" style={styles.errorBox}><Text style={styles.error}>{error}</Text><Pressable accessibilityRole="button" onPress={()=>void load()} style={styles.retryButton}><Text style={styles.retryText}>Coba lagi</Text></Pressable></View> : null}
        {me ? (
          <>
            <View ref={identityRef} collapsable={false} style={styles.identity}>
              <View
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
                style={styles.avatar}
              >
                <Text style={styles.avatarText}>
                  {me.fullName.slice(0, 1).toUpperCase()}
                </Text>
              </View>
              <View style={styles.identityCopy}>
                <Text style={styles.name}>{me.fullName}</Text>
                <Text style={styles.email}>{me.email}</Text>
              </View>
            </View>
            <View style={styles.details}>
              <Detail
                icon="id-card-outline"
                label="Nomor karyawan"
                value={me.employeeNumber}
              />
              <Detail
                icon="business-outline"
                label="Organisasi"
                value={activeOrganization?.name ?? "Memuat organisasi…"}
              />
              <Detail
                icon="shield-checkmark-outline"
                label="Peran"
                value={me.roles.map(roleLabel).join(" · ")}
              />
            </View>
            {organizations.length > 1 ? (
              <View style={styles.organizationSection}>
                <Text style={styles.sectionTitle}>Pilih organisasi</Text>
                <Text style={styles.copy}>
                  Data jadwal dan absensi akan mengikuti organisasi aktif.
                </Text>
                <View style={styles.organizationList}>
                  {organizations.map((organization) => {
                    const active = organization.id === me.organizationId;
                    return (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityState={{ selected: active }}
                        disabled={active || Boolean(switching)}
                        key={organization.id}
                        onPress={() => void chooseOrganization(organization.id)}
                        style={styles.organizationRow}
                      >
                        <View style={styles.organizationCopy}>
                          <Text style={styles.organizationName}>
                            {organization.name}
                          </Text>
                          <Text style={styles.organizationCode}>
                            {organization.code} · {organization.timezone}
                          </Text>
                        </View>
                        {switching === organization.id ? (
                          <ActivityIndicator color={colors.gold} />
                        ) : (
                          <Ionicons
                            name={active ? "checkmark" : "chevron-forward"}
                            size={19}
                            color={active ? colors.emerald : colors.inkMuted}
                          />
                        )}
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ) : null}
            {me.roles.some((role) => role === "SUPERVISOR" || role === "OWNER") ? (
              <AccountRegistrationCard token={token} roles={me.roles} />
            ) : null}
            {me.roles.some(
              (role) =>
                role === "SUPERVISOR" ||
                role === "ADMIN" ||
                role === "OWNER",
            ) ? (
              <ShowroomManagementCard
                token={token}
                defaultTimezone={me.timezone}
              />
            ) : null}
          </>
        ) : null}
        <View style={styles.security}>
          <Text style={styles.sectionTitle}>Verifikasi wajah</Text>
          <Text style={styles.copy}>Pendaftaran hanya dipakai bila kebijakan outlet mewajibkan pencocokan wajah dan liveness.</Text>
          {faceNotice?<Text style={styles.faceNotice}>{faceNotice}</Text>:null}
          <Pressable accessibilityRole="button" accessibilityLabel="Daftarkan atau perbarui wajah" disabled={faceSaving} onPress={()=>void enrollFace()} style={styles.faceButton}><Ionicons name="scan-outline" size={19} color={colors.espresso}/><Text style={styles.faceButtonText}>{faceSaving?"Mendaftarkan…":"Daftarkan atau perbarui wajah"}</Text></Pressable>
        </View>
        <View ref={securityRef} collapsable={false} style={styles.security}>
          <Text style={styles.sectionTitle}>Keamanan sesi</Text>
          <Text style={styles.copy}>
            {auth.isDemo
              ? "Sesi dan seluruh perubahan demo tersimpan hanya di perangkat ini. Keluar tidak mengirim data ke server."
              : "Token sesi disimpan di penyimpanan aman perangkat dan dicabut saat Anda keluar."}
          </Text>
          {auth.isDemo ? (
            <>
              {demoNotice ? <Text style={styles.faceNotice}>{demoNotice}</Text> : null}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Reset data demo"
                onPress={() =>
                  void import("../lib/demoApi")
                    .then(({ resetDemoData }) => resetDemoData())
                    .then(() =>
                      setDemoNotice(
                        "Data demo sudah dikembalikan ke kondisi awal. Buka Home untuk memulai lagi.",
                      ),
                    )
                }
                style={styles.demoReset}
              >
                <Ionicons name="refresh-outline" size={18} color={colors.espresso} />
                <Text style={styles.demoResetText}>Reset data demo</Text>
              </Pressable>
            </>
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={auth.isDemo ? "Keluar dari demo" : "Keluar dari akun"}
            onPress={() => void auth.logout()}
            style={styles.logout}
          >
            <Ionicons name="log-out-outline" size={19} color={colors.ruby} />
            <Text>{auth.isDemo ? "Keluar dari demo" : "Keluar dari akun"}</Text>
          </Pressable>
        </View>
      </ScrollView>
      <TutorialLauncher
        accessibilityLabel="Buka tutorial Profil"
        steps={[
          {
            target: identityRef,
            title: "Periksa akun dan peran",
            body: "Pastikan nama, email, nomor karyawan, organisasi, dan peran Anda benar. Supervisor juga dapat mendaftarkan akun karyawan serta mengelola master showroom dari halaman ini.",
          },
          {
            target: securityRef,
            title: "Kelola keamanan sesi",
            body: "Gunakan bagian ini untuk mereset data demo bila perlu atau keluar dengan aman dari akun dan perangkat.",
          },
        ]}
      />
    </Screen>
  );
}
function Detail({
  icon,
  label,
  value,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
}) {
  return (
    <View style={styles.detail}>
      <Ionicons name={icon} size={19} color={colors.gold} />
      <View style={styles.detailCopy}>
        <Text style={styles.label}>{label}</Text>
        <Text style={styles.value}>{value}</Text>
      </View>
    </View>
  );
}
function roleLabel(role: string) {
  const labels: Record<string, string> = {
    EMPLOYEE: "Karyawan",
    SUPERVISOR: "Supervisor",
    ADMIN: "Administrator",
    HR: "HR",
    OWNER: "Superadmin",
  };
  return labels[role] ?? role;
}
const styles = StyleSheet.create({
  content: { padding: spacing.lg, paddingBottom: 110 },
  eyebrow: {
    fontSize: 10,
    letterSpacing: 1.8,
    fontWeight: "700",
    color: "#8A6C2D",
  },
  title: {
    fontFamily: "serif",
    fontSize: 32,
    color: colors.espresso,
    marginTop: 6,
  },
  rule: { height: 1, backgroundColor: colors.line, marginVertical: spacing.lg },
  loader: { marginTop: 60 },
  error: { color: colors.ruby },
  errorBox:{flexDirection:"row",alignItems:"center",gap:spacing.sm,padding:spacing.md,backgroundColor:"#FBEFEF",borderLeftWidth:3,borderColor:colors.ruby},
  retryButton:{minHeight:44,justifyContent:"center",marginLeft:"auto"},retryText:{color:colors.ruby,fontWeight:"700",fontSize:12},
  identity: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  avatar: {
    flexShrink: 0,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.espresso,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { color: colors.goldSoft, fontWeight: "700" },
  identityCopy: { flex: 1, minWidth: 0 },
  name: { fontFamily: "serif", fontSize: 23, color: colors.espresso },
  email: { flexShrink: 1, fontSize: 12, color: colors.inkMuted, marginTop: 3 },
  details: {
    marginTop: spacing.lg,
    borderTopWidth: 1,
    borderColor: colors.line,
  },
  detail: {
    minHeight: 68,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    borderBottomWidth: 1,
    borderColor: colors.line,
  },
  detailCopy: { flex: 1, minWidth: 0, paddingVertical: spacing.sm },
  label: { fontSize: 10, letterSpacing: 0.8, color: colors.inkMuted },
  value: { flexShrink: 1, fontWeight: "600", color: colors.espresso, marginTop: 4 },
  security: { marginTop: spacing.xl },
  organizationSection: { marginTop: spacing.xl },
  organizationList: {
    marginTop: spacing.md,
    borderTopWidth: 1,
    borderColor: colors.line,
  },
  organizationRow: {
    minHeight: 66,
    borderBottomWidth: 1,
    borderColor: colors.line,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  organizationCopy: { flex: 1, minWidth: 0, paddingVertical: spacing.sm },
  organizationName: { color: colors.espresso, fontWeight: "700" },
  organizationCode: { color: colors.inkMuted, fontSize: 11, marginTop: 4 },
  sectionTitle: { fontFamily: "serif", fontSize: 22, color: colors.espresso },
  copy: { color: colors.inkMuted, lineHeight: 20, marginTop: 6 },
  logout: {
    minHeight: 52,
    paddingVertical: spacing.sm,
    marginTop: spacing.lg,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.line,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
  },
  faceButton:{minHeight:52,marginTop:spacing.md,borderWidth:1,borderColor:colors.espresso,flexDirection:"row",alignItems:"center",justifyContent:"center",gap:spacing.sm,paddingHorizontal:spacing.md,paddingVertical:spacing.sm},faceButtonText:{flexShrink:1,textAlign:"center"},faceNotice:{color:colors.emerald,marginTop:spacing.sm,fontSize:12},
  demoReset:{minHeight:48,marginTop:spacing.md,borderWidth:1,borderColor:colors.gold,flexDirection:"row",alignItems:"center",justifyContent:"center",gap:spacing.sm},demoResetText:{color:colors.espresso,fontWeight:"700"},
});
