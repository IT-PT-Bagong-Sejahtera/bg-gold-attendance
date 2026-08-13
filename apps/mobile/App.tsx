import { ActivityIndicator, Image, StatusBar, StyleSheet, Text, View } from "react-native";
import { useEffect, useState } from "react";
import { NavigationContainer, DefaultTheme } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import { AuthProvider, useAuth } from "./src/lib/auth";
import { LoginScreen } from "./src/screens/LoginScreen";
import { HomeScreen } from "./src/screens/HomeScreen";
import { AttendanceScreen } from "./src/screens/AttendanceScreen";
import { RequestsScreen } from "./src/screens/RequestsScreen";
import { ScheduleScreen } from "./src/screens/ScheduleScreen";
import { ProfileScreen } from "./src/screens/ProfileScreen";
import { SupervisorScreen } from "./src/screens/SupervisorScreen";
import { SupervisorAttendanceScreen } from "./src/screens/SupervisorAttendanceScreen";
import { api } from "./src/lib/api";
import { colors } from "./src/theme";

const Tabs = createBottomTabNavigator();
const theme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: colors.ivory,
    card: colors.paper,
    text: colors.espresso,
    border: colors.line,
    primary: colors.gold,
  },
};

const tabIcons: Record<string, keyof typeof Ionicons.glyphMap> = {
  Home: "home-outline",
  Schedule: "calendar-outline",
  Attendance: "time-outline",
  Requests: "file-tray-full-outline",
  Profile: "person-outline",
  Approvals: "checkmark-done-outline",
};

function Root() {
  const { session, ready, demoRole } = useAuth();
  const insets = useSafeAreaInsets();
  const [roles, setRoles] = useState<string[] | null>(null);

  useEffect(() => {
    let active = true;
    if (!session) {
      setRoles(null);
      return () => {
        active = false;
      };
    }
    if (demoRole) {
      setRoles([demoRole === "supervisor" ? "SUPERVISOR" : "EMPLOYEE"]);
      return () => {
        active = false;
      };
    }
    setRoles(null);
    void api
      .me(session.accessToken)
      .then((identity) => {
        if (active) setRoles(identity.roles);
      })
      .catch(() => {
        if (active) setRoles([]);
      });
    return () => {
      active = false;
    };
  }, [demoRole, session?.accessToken]);

  if (!ready || (session && roles === null)) {
    return (
      <View style={styles.launch}>
        <Image
          source={require("./assets/bg-gold-logo.png")}
          resizeMode="contain"
          style={styles.logo}
        />
        <ActivityIndicator color={colors.gold} />
        <Text>Menyiapkan ruang kerja…</Text>
      </View>
    );
  }

  if (!session) {
    return <LoginScreen />;
  }

  const isSupervisor = roles?.includes("SUPERVISOR") ?? false;

  return (
    <NavigationContainer theme={theme}>
      <Tabs.Navigator
        screenOptions={({ route }) => ({
          headerShown: false,
          tabBarActiveTintColor: colors.espresso,
          tabBarInactiveTintColor: colors.inkMuted,
          tabBarAllowFontScaling: false,
          tabBarStyle: [
            styles.tabBar,
            {
              height: 72 + insets.bottom,
              paddingBottom: 10 + insets.bottom,
            },
          ],
          tabBarLabelStyle: styles.tabLabel,
          tabBarIcon: ({ color, size }) => (
            <Ionicons
              color={color}
              size={size}
              name={tabIcons[route.name] ?? "ellipse-outline"}
            />
          ),
        })}
      >
        <Tabs.Screen
          name="Home"
          component={HomeScreen}
          options={{ tabBarAccessibilityLabel: "Home" }}
        />
        <Tabs.Screen
          name="Schedule"
          component={ScheduleScreen}
          options={{
            title: "Jadwal",
            tabBarAccessibilityLabel: "Jadwal",
          }}
        />
        <Tabs.Screen
          name="Attendance"
          component={isSupervisor ? SupervisorAttendanceScreen : AttendanceScreen}
          options={{
            title: "Hadir",
            tabBarAccessibilityLabel: "Kehadiran",
          }}
        />
        {isSupervisor ? (
          <Tabs.Screen
            name="Approvals"
            component={SupervisorScreen}
            options={{
              title: "Setujui",
              tabBarAccessibilityLabel: "Persetujuan tim",
            }}
          />
        ) : (
          <Tabs.Screen
            name="Requests"
            component={RequestsScreen}
            options={{
              title: "Ajuan",
              tabBarAccessibilityLabel: "Permintaan",
            }}
          />
        )}
        <Tabs.Screen
          name="Profile"
          component={ProfileScreen}
          options={{
            title: "Profil",
            tabBarAccessibilityLabel: "Profil",
          }}
        />
      </Tabs.Navigator>
    </NavigationContainer>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar barStyle="dark-content" backgroundColor={colors.ivory} />
      <AuthProvider>
        <Root />
      </AuthProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  launch: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
    backgroundColor: colors.ivory,
  },
  logo: { width: 120, height: 72 },
  tabBar: {
    height: 72,
    paddingTop: 8,
    paddingBottom: 10,
    backgroundColor: colors.paper,
    borderTopColor: colors.line,
  },
  tabLabel: { fontSize: 9, fontWeight: "700", letterSpacing: -0.15 },
});
