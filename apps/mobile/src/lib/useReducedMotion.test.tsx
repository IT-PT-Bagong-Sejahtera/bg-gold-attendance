import { render, screen, waitFor } from "@testing-library/react-native";
import { AccessibilityInfo, Text } from "react-native";
import { useReducedMotion } from "./useReducedMotion";

function MotionProbe() {
  return <Text>{useReducedMotion() ? "reduced" : "full"}</Text>;
}

describe("useReducedMotion", () => {
  afterEach(() => jest.restoreAllMocks());

  it("uses the operating-system reduce-motion preference", async () => {
    jest
      .spyOn(AccessibilityInfo, "isReduceMotionEnabled")
      .mockResolvedValue(true);
    const remove = jest.fn();
    jest
      .spyOn(AccessibilityInfo, "addEventListener")
      .mockReturnValue(
        { remove } as unknown as ReturnType<
          typeof AccessibilityInfo.addEventListener
        >,
      );

    const view = await render(<MotionProbe />);
    expect(await screen.findByText("reduced")).toBeTruthy();
    view.unmount();
    await waitFor(() => expect(remove).toHaveBeenCalledTimes(1));
  });
});
