import WifiManager from "react-native-wifi-reborn";

export async function captureCurrentWiFi() {
  const [ssid, bssid] = await Promise.all([
    WifiManager.getCurrentWifiSSID(),
    WifiManager.getBSSID(),
  ]);
  if (!ssid || !bssid) throw new Error("Wi-Fi aktif tidak dapat dikenali.");
  return { ssid, bssid };
}
