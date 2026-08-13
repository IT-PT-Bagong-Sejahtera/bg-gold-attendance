import { registerRootComponent } from "expo";
import * as Notifications from "expo-notifications";
import App from "./App";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: true,
  }),
});

registerRootComponent(App);
