import { Ionicons } from "@expo/vector-icons";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type RefObject,
} from "react";
import {
  Modal,
  Platform,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { colors, spacing } from "../theme";

export type TutorialStep = {
  body: string;
  target: RefObject<View | null>;
  title: string;
};

export function TutorialLauncher({
  accessibilityLabel,
  steps,
}: {
  accessibilityLabel: string;
  steps: TutorialStep[];
}) {
  const [visible, setVisible] = useState(false);
  return (
    <>
      <Pressable
        accessibilityHint="Membuka panduan langkah demi langkah untuk halaman ini"
        accessibilityLabel={accessibilityLabel}
        accessibilityRole="button"
        onPress={() => setVisible(true)}
        style={({ pressed }) => [
          styles.launcher,
          pressed && styles.launcherPressed,
        ]}
      >
        <Ionicons name="help-circle-outline" size={18} color={colors.espresso} />
        <Text style={styles.launcherText}>Tutorial</Text>
      </Pressable>
      <GuidedTutorial
        onClose={() => setVisible(false)}
        steps={steps}
        visible={visible}
      />
    </>
  );
}

type Spotlight = {
  height: number;
  width: number;
  x: number;
  y: number;
};

const SPOTLIGHT_PADDING = 8;
const SCREEN_PADDING = 12;
const MESSAGE_HEIGHT = 230;

export function GuidedTutorial({
  onClose,
  steps,
  visible,
}: {
  onClose(): void;
  steps: TutorialStep[];
  visible: boolean;
}) {
  const { height: windowHeight, width: windowWidth } = useWindowDimensions();
  const statusBarOffset =
    Platform.OS === "android" ? (StatusBar.currentHeight ?? 0) : 0;
  const [stepIndex, setStepIndex] = useState(0);
  const [spotlight, setSpotlight] = useState<Spotlight | null>(null);
  const step = steps[stepIndex];

  const measureTarget = useCallback(() => {
    if (!visible || !step) return;
    const node = step.target.current;
    if (!node?.measureInWindow) {
      setSpotlight(null);
      return;
    }
    node.measureInWindow((x, y, width, height) => {
      if (width <= 0 || height <= 0) {
        setSpotlight(null);
        return;
      }
      const left = Math.max(SCREEN_PADDING, x - SPOTLIGHT_PADDING);
      // A translucent Android modal starts above the status bar, while
      // measureInWindow reports the app-content origin below it.
      const targetY = y + statusBarOffset;
      const top = Math.max(SCREEN_PADDING, targetY - SPOTLIGHT_PADDING);
      const right = Math.min(
        windowWidth - SCREEN_PADDING,
        x + width + SPOTLIGHT_PADDING,
      );
      const bottom = Math.min(
        windowHeight - SCREEN_PADDING,
        targetY + height + SPOTLIGHT_PADDING,
      );
      setSpotlight({
        x: left,
        y: top,
        width: Math.max(1, right - left),
        height: Math.max(1, bottom - top),
      });
    });
  }, [statusBarOffset, step, visible, windowHeight, windowWidth]);

  useEffect(() => {
    if (!visible) {
      setStepIndex(0);
      setSpotlight(null);
      return;
    }
    setSpotlight(null);
    const timer = setTimeout(measureTarget, 60);
    return () => clearTimeout(timer);
  }, [measureTarget, stepIndex, visible]);

  const messagePosition = useMemo(() => {
    if (!spotlight) {
      return {
        cardTop: Math.max(48, (windowHeight - MESSAGE_HEIGHT) / 2),
        pointsDown: false,
      };
    }
    const roomBelow = windowHeight - (spotlight.y + spotlight.height);
    const useBelow = roomBelow >= MESSAGE_HEIGHT || spotlight.y < MESSAGE_HEIGHT;
    return {
      cardTop: useBelow
        ? Math.min(
            spotlight.y + spotlight.height + 48,
            windowHeight - MESSAGE_HEIGHT,
          )
        : Math.max(32, spotlight.y - MESSAGE_HEIGHT),
      pointsDown: !useBelow,
    };
  }, [spotlight, windowHeight]);

  if (!step || steps.length === 0) return null;
  const isLast = stepIndex === steps.length - 1;
  const arrowLeft = spotlight
    ? Math.min(
        windowWidth - 62,
        Math.max(22, spotlight.x + spotlight.width / 2 - 18),
      )
    : windowWidth / 2 - 18;

  function close() {
    setStepIndex(0);
    setSpotlight(null);
    onClose();
  }

  function next() {
    if (isLast) {
      close();
      return;
    }
    setStepIndex((current) => current + 1);
  }

  return (
    <Modal
      animationType="fade"
      onRequestClose={close}
      onShow={measureTarget}
      statusBarTranslucent
      transparent
      visible={visible}
    >
      <View
        accessibilityLabel="Tutorial jadwal"
        accessibilityRole="none"
        accessibilityViewIsModal
        style={styles.overlay}
      >
        {spotlight ? (
          <>
            <View
              pointerEvents="none"
              style={[
                styles.dim,
                { height: spotlight.y, left: 0, right: 0, top: 0 },
              ]}
            />
            <View
              pointerEvents="none"
              style={[
                styles.dim,
                {
                  height: spotlight.height,
                  left: 0,
                  top: spotlight.y,
                  width: spotlight.x,
                },
              ]}
            />
            <View
              pointerEvents="none"
              style={[
                styles.dim,
                {
                  height: spotlight.height,
                  left: spotlight.x + spotlight.width,
                  right: 0,
                  top: spotlight.y,
                },
              ]}
            />
            <View
              pointerEvents="none"
              style={[
                styles.dim,
                {
                  bottom: 0,
                  left: 0,
                  right: 0,
                  top: spotlight.y + spotlight.height,
                },
              ]}
            />
            <View
              pointerEvents="none"
              style={[
                styles.spotlightBorder,
                {
                  height: spotlight.height,
                  left: spotlight.x,
                  top: spotlight.y,
                  width: spotlight.width,
                },
              ]}
            />
          </>
        ) : (
          <View
            pointerEvents="none"
            style={[StyleSheet.absoluteFill, styles.dim]}
          />
        )}

        {spotlight ? (
          <View
            pointerEvents="none"
            style={[
              styles.arrow,
              messagePosition.pointsDown
                ? { left: arrowLeft, top: spotlight.y - 43 }
                : {
                    left: arrowLeft,
                    top: spotlight.y + spotlight.height + 5,
                  },
            ]}
          >
            <Ionicons
              color={colors.white}
              name={messagePosition.pointsDown ? "arrow-down" : "arrow-up"}
              size={36}
            />
          </View>
        ) : null}

        <View style={[styles.message, { top: messagePosition.cardTop }]}>
          <View style={styles.messageHeading}>
            <View style={styles.stepPill}>
              <Text style={styles.stepPillText}>
                LANGKAH {stepIndex + 1} / {steps.length}
              </Text>
            </View>
            <Pressable
              accessibilityLabel="Lewati tutorial"
              accessibilityRole="button"
              onPress={close}
              style={styles.skipButton}
            >
              <Text style={styles.skipText}>Lewati</Text>
            </Pressable>
          </View>
          <Text style={styles.title}>{step.title}</Text>
          <Text style={styles.body}>{step.body}</Text>
          <View style={styles.actions}>
            {stepIndex > 0 ? (
              <Pressable
                accessibilityLabel="Kembali ke langkah tutorial sebelumnya"
                accessibilityRole="button"
                onPress={() => setStepIndex((current) => current - 1)}
                style={styles.backButton}
              >
                <Ionicons name="arrow-back" size={17} color={colors.white} />
                <Text style={styles.backText}>Kembali</Text>
              </Pressable>
            ) : (
              <View />
            )}
            <Pressable
              accessibilityLabel={
                isLast ? "Selesaikan tutorial" : "Lanjutkan tutorial"
              }
              accessibilityRole="button"
              onPress={next}
              style={styles.nextButton}
            >
              <Text style={styles.nextText}>
                {isLast ? "Selesai" : "Lanjut"}
              </Text>
              <Ionicons
                name={isLast ? "checkmark" : "arrow-forward"}
                size={18}
                color={colors.espresso}
              />
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  launcher: {
    position: "absolute",
    zIndex: 20,
    right: spacing.md,
    bottom: spacing.md,
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderColor: colors.gold,
    borderRadius: 23,
    paddingHorizontal: 14,
    backgroundColor: colors.paper,
    shadowColor: colors.espresso,
    shadowOpacity: 0.16,
    shadowRadius: 7,
    shadowOffset: { width: 0, height: 3 },
    elevation: 5,
  },
  launcherPressed: { backgroundColor: colors.goldSoft },
  launcherText: { color: colors.espresso, fontSize: 11, fontWeight: "900" },
  overlay: { flex: 1 },
  dim: { position: "absolute", backgroundColor: "rgba(12, 7, 5, .86)" },
  spotlightBorder: {
    position: "absolute",
    borderWidth: 2,
    borderRadius: 12,
    borderColor: colors.goldSoft,
    shadowColor: colors.gold,
    shadowOpacity: 0.7,
    shadowRadius: 12,
    elevation: 8,
  },
  arrow: { position: "absolute", width: 36, height: 38 },
  message: {
    position: "absolute",
    left: spacing.lg,
    right: spacing.lg,
    minHeight: 190,
    paddingVertical: spacing.md,
  },
  messageHeading: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  stepPill: {
    borderWidth: 1,
    borderColor: "rgba(255, 249, 238, .45)",
    borderRadius: 999,
    paddingHorizontal: 11,
    paddingVertical: 6,
  },
  stepPillText: {
    color: colors.goldSoft,
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 1.1,
  },
  skipButton: {
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  skipText: {
    color: colors.white,
    fontSize: 12,
    textDecorationLine: "underline",
  },
  title: {
    color: colors.white,
    fontFamily: "serif",
    fontSize: 26,
    lineHeight: 32,
    marginTop: 4,
  },
  body: { color: colors.white, fontSize: 14, lineHeight: 21, marginTop: 7 },
  actions: {
    minHeight: 50,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: spacing.md,
  },
  backButton: {
    minHeight: 46,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingHorizontal: 4,
  },
  backText: { color: colors.white, fontSize: 12, fontWeight: "800" },
  nextButton: {
    minHeight: 46,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 23,
    paddingHorizontal: 18,
    backgroundColor: colors.goldSoft,
  },
  nextText: { color: colors.espresso, fontSize: 12, fontWeight: "900" },
});
