import type { ImageSourcePropType } from "react-native";

const images: Record<string, ImageSourcePropType> = {
  "demo-selfie-ayu": require("../../assets/demo-selfie-ayu.png"),
  "demo-selfie-dimas": require("../../assets/demo-selfie-dimas.png"),
  "demo-selfie-raka": require("../../assets/demo-selfie-raka.png"),
};

export function demoEvidenceImage(imageKey?: string) {
  return imageKey ? images[imageKey] : undefined;
}
