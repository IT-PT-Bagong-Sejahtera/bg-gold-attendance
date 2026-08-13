import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { api } from "../lib/api";
import * as ImagePicker from "expo-image-picker";
import { RequestsScreen } from "./RequestsScreen";

jest.mock("../lib/auth", () => ({
  useAuth: () => ({ session: { accessToken: "requests-token" } }),
}));

jest.mock("../lib/api", () => ({
  api: {
    me: jest.fn(async () => ({ timezone: "Asia/Jakarta" })),
    requests: jest.fn(),
    leaveRequests: jest.fn(),
    leaveTypes: jest.fn(),
    leaveBalances: jest.fn(),
    createLeaveRequest: jest.fn(),
    withdrawLeaveRequest: jest.fn(),
    claimTypes: jest.fn(),
    claims: jest.fn(),
    claimReceipt: jest.fn(),
    createClaim: jest.fn(),
    withdrawClaim: jest.fn(),
  },
}));

jest.mock("expo-image-picker", () => ({
  CameraType: { back: "back" },
  requestCameraPermissionsAsync: jest.fn(async () => ({ granted: true })),
  launchCameraAsync: jest.fn(async () => ({ canceled: false, assets: [{ uri: "file:///claim.jpg", mimeType: "image/jpeg" }] })),
}));

jest.mock("@react-native-community/datetimepicker", () => {
  const React = require("react");
  const { View } = require("react-native");
  return {
    __esModule: true,
    default: (props: object) => React.createElement(View, props),
  };
});

describe("RequestsScreen leave flow", () => {
  it("creates and withdraws a leave request while showing the balance", async () => {
    const pending = { id: "leave-1", leaveTypeId: "annual", leaveTypeName: "Cuti Tahunan", startsOn: "2026-09-14", endsOn: "2026-09-16", totalDays: 3, reason: "Keperluan keluarga", status: "PENDING", requestedAt: "2026-08-11T04:00:00Z" };
    (api.requests as jest.Mock).mockResolvedValue([]);
    (api.leaveTypes as jest.Mock).mockResolvedValue([{ id: "annual", code: "ANNUAL", name: "Cuti Tahunan", paid: true, status: "ACTIVE" }]);
    (api.leaveBalances as jest.Mock).mockResolvedValue([{ id: "balance-1", leaveTypeId: "annual", leaveTypeName: "Cuti Tahunan", year: 2026, entitlementDays: 12, usedDays: 2, pendingDays: 0, availableDays: 10 }]);
    (api.leaveRequests as jest.Mock).mockResolvedValueOnce([]).mockResolvedValueOnce([pending]).mockResolvedValue([{ ...pending, status: "WITHDRAWN" }]);
    (api.createLeaveRequest as jest.Mock).mockResolvedValue({ id: "leave-1", status: "PENDING", totalDays: 3 });
    (api.withdrawLeaveRequest as jest.Mock).mockResolvedValue({ id: "leave-1", status: "WITHDRAWN" });
    (api.claimTypes as jest.Mock).mockResolvedValue([]);
    (api.claims as jest.Mock).mockResolvedValue([]);

    await render(<RequestsScreen />);
    expect(await screen.findByText("10")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "+ Ajukan cuti" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Cuti Tahunan" }));
    expect(
      screen.getByRole("button", { name: "Cuti Tahunan" }).props
        .accessibilityState,
    ).toEqual({ selected: true });
    await fireEvent.changeText(await screen.findByLabelText("Tanggal mulai cuti"), "2026-09-14");
    await fireEvent.changeText(screen.getByLabelText("Tanggal selesai cuti"), "2026-09-16");
    await fireEvent.changeText(screen.getByLabelText("Alasan cuti"), "Keperluan keluarga");
    await fireEvent.press(screen.getByRole("button", { name: "Kirim permintaan" }));

    await waitFor(() => expect(api.createLeaveRequest).toHaveBeenCalledWith("requests-token", { leaveTypeId: "annual", startsOn: "2026-09-14", endsOn: "2026-09-16", reason: "Keperluan keluarga" }));
    const withdraw = await screen.findByRole("button", { name: "Batalkan permintaan" });
    await fireEvent.press(withdraw);
    await waitFor(() => expect(api.withdrawLeaveRequest).toHaveBeenCalledWith("requests-token", "leave-1"));
    expect(await screen.findByText("Dibatalkan")).toBeTruthy();
  });

  it("uploads a private receipt, creates a claim, and withdraws it", async () => {
    const pending = { id: "claim-1", claimTypeId: "travel", claimTypeName: "Perjalanan Dinas", title: "Taksi ke outlet", amount: 175000, currency: "IDR", incurredOn: "2026-08-11", notes: "Transportasi outlet", attachmentId: "receipt-1", status: "PENDING", ocrStatus: "NOT_CONFIGURED", requestedAt: "2026-08-11T04:00:00Z" };
    (api.requests as jest.Mock).mockResolvedValue([]);
    (api.leaveTypes as jest.Mock).mockResolvedValue([]);
    (api.leaveBalances as jest.Mock).mockResolvedValue([]);
    (api.leaveRequests as jest.Mock).mockResolvedValue([]);
    (api.claimTypes as jest.Mock).mockResolvedValue([{ id: "travel", code: "TRAVEL", name: "Perjalanan Dinas", receiptRequired: true, status: "ACTIVE" }]);
    (api.claims as jest.Mock).mockResolvedValueOnce([]).mockResolvedValueOnce([pending]).mockResolvedValue([{ ...pending, status: "WITHDRAWN" }]);
    (api.claimReceipt as jest.Mock).mockResolvedValue({ id: "receipt-1", contentType: "image/jpeg", sizeBytes: 1200 });
    (api.createClaim as jest.Mock).mockResolvedValue({ id: "claim-1", status: "PENDING" });
    (api.withdrawClaim as jest.Mock).mockResolvedValue({ id: "claim-1", status: "WITHDRAWN" });

    await render(<RequestsScreen />);
    await fireEvent.press(await screen.findByRole("button", { name: "+ Ajukan klaim" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Perjalanan Dinas" }));
    await fireEvent.changeText(screen.getByLabelText("Judul klaim"), "Taksi ke outlet");
    await fireEvent.changeText(screen.getByLabelText("Nominal klaim"), "175000");
    await fireEvent.press(screen.getByRole("button", { name: "Pilih tanggal biaya" }));
    await fireEvent(
      screen.getByTestId("tanggal-biaya-picker"),
      "onChange",
      { type: "set" },
      new Date(2026, 7, 11),
    );
    expect(screen.getByText("11 Agustus 2026")).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText("Catatan klaim"), "Transportasi outlet");
    await fireEvent.press(screen.getByRole("button", { name: "Foto struk" }));
    expect(ImagePicker.launchCameraAsync).toHaveBeenCalled();
    expect(await screen.findByText("Struk siap diunggah")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Kirim klaim" }));

    await waitFor(() => expect(api.createClaim).toHaveBeenCalledWith("requests-token", { claimTypeId: "travel", title: "Taksi ke outlet", amount: 175000, currency: "IDR", incurredOn: "2026-08-11", notes: "Transportasi outlet", attachmentId: "receipt-1" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Tarik klaim" }));
    await waitFor(() => expect(api.withdrawClaim).toHaveBeenCalledWith("requests-token", "claim-1"));
    expect(await screen.findByText("Dibatalkan")).toBeTruthy();
  });
});
