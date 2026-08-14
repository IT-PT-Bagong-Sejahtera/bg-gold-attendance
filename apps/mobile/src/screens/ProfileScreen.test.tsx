import {
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
import { api } from "../lib/api";
import { ProfileScreen } from "./ProfileScreen";

const mockSwitchOrganization = jest.fn(async () => undefined);
const mockLogout = jest.fn(async () => undefined);

jest.mock("../lib/auth", () => ({
  useAuth: () => ({
    session: { accessToken: "active-token" },
    switchOrganization: mockSwitchOrganization,
    logout: mockLogout,
  }),
}));
jest.mock("../lib/kioskMode", () => ({
  useKioskMode: () => ({ activate: jest.fn(async () => undefined), clear: jest.fn(async () => undefined), kiosk: null, ready: true }),
}));

jest.mock("../lib/api", () => ({
  api: {
    me: jest.fn(),
    organizations: jest.fn(),
    faceImage: jest.fn(),
    enrollFace: jest.fn(),
    createEmployee: jest.fn(),
    sections: jest.fn(),
    createSection: jest.fn(),
    updateSection: jest.fn(),
    setSectionStatus: jest.fn(),
    activateKiosk: jest.fn(),
    employees: jest.fn(),
    resetEmployeeKioskPIN: jest.fn(),
  },
}));
jest.mock("expo-image-picker",()=>({CameraType:{front:"front"},requestCameraPermissionsAsync:jest.fn(async()=>({granted:true})),launchCameraAsync:jest.fn(async()=>({canceled:false,assets:[{uri:"file:///face.jpg",mimeType:"image/jpeg"}]}))}));

describe("ProfileScreen organization selector", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (api.me as jest.Mock).mockResolvedValue({
      id: "user-1",
      email: "ayu@bggold.local",
      fullName: "Ayu Pratama",
      membershipId: "membership-1",
      organizationId: "organization-main",
      employeeNumber: "BG-017",
      roles: ["EMPLOYEE"],
    });
    (api.organizations as jest.Mock).mockResolvedValue([
      {
        id: "organization-main",
        code: "BG-GOLD",
        name: "BG GOLD",
        timezone: "Asia/Jakarta",
      },
      {
        id: "organization-workshop",
        code: "BG-WORKSHOP",
        name: "BG GOLD Workshop",
        timezone: "Asia/Makassar",
      },
    ]);
    (api.faceImage as jest.Mock).mockResolvedValue({id:"face-image-1"});
    (api.enrollFace as jest.Mock).mockResolvedValue({id:"enrollment-1",status:"ACTIVE"});
    (api.sections as jest.Mock).mockResolvedValue([]);
    (api.employees as jest.Mock).mockResolvedValue([]);
    (api.createSection as jest.Mock).mockResolvedValue({ id: "section-new" });
    (api.updateSection as jest.Mock).mockResolvedValue({ id: "section-1" });
    (api.setSectionStatus as jest.Mock).mockResolvedValue({ id: "section-1", status: "INACTIVE" });
  });

  it("switches through the authenticated organization flow", async () => {
    await render(<ProfileScreen />);

    await fireEvent.press(
      await screen.findByRole("button", { name: /BG GOLD Workshop/ }),
    );

    await waitFor(() => {
      expect(mockSwitchOrganization).toHaveBeenCalledWith(
        "organization-workshop",
      );
    });
  });

  it("logs out from the visible profile action", async () => {
    await render(<ProfileScreen />);

    await fireEvent.press(
      await screen.findByRole("button", { name: "Keluar dari akun" }),
    );

    expect(mockLogout).toHaveBeenCalledTimes(1);
  });

  it("captures and enrolls a face through the provider-neutral API",async()=>{
    await render(<ProfileScreen/>);await fireEvent.press(await screen.findByRole("button",{name:"Daftarkan atau perbarui wajah"}));
    await waitFor(()=>expect(api.enrollFace).toHaveBeenCalledWith("active-token","face-image-1"));expect(await screen.findByText("Wajah berhasil didaftarkan untuk verifikasi absensi.")).toBeTruthy();
  });

  it("lets a supervisor add a showroom from Profile", async () => {
    (api.me as jest.Mock).mockResolvedValue({
      id: "supervisor-1",
      email: "supervisor@bggold.local",
      fullName: "Sari Supervisor",
      membershipId: "membership-supervisor",
      organizationId: "organization-main",
      employeeNumber: "BG-SPV-01",
      timezone: "Asia/Jakarta",
      roles: ["SUPERVISOR"],
    });

    await render(<ProfileScreen />);
    await fireEvent.press(await screen.findByRole("button", { name: "Tambah showroom" }));
    const codeInput = await screen.findByLabelText("kode showroom");
    await fireEvent.changeText(codeInput, "kemang");
    await fireEvent.changeText(screen.getByLabelText("nama showroom"), "BG GOLD Kemang");
    await fireEvent.changeText(screen.getByLabelText("alamat"), "Kemang, Jakarta Selatan");
    expect(screen.getByDisplayValue("KEMANG")).toBeTruthy();
    expect(screen.getByDisplayValue("BG GOLD Kemang")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Simpan showroom" }));

    await waitFor(() =>
      expect(api.createSection).toHaveBeenCalledWith("active-token", {
        code: "KEMANG",
        name: "BG GOLD Kemang",
        address: "Kemang, Jakarta Selatan",
        timezone: "Asia/Jakarta",
      }),
    );
    expect(await screen.findByText("Showroom baru berhasil ditambahkan.")).toBeTruthy();
  });
});
