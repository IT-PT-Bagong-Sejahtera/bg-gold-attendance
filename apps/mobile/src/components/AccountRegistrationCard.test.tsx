import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { api } from "../lib/api";
import { AccountRegistrationCard } from "./AccountRegistrationCard";

jest.mock("../lib/api", () => ({
  api: { createEmployee: jest.fn(async () => ({ id: "membership-new" })) },
}));

async function completeForm() {
  await fireEvent.changeText(screen.getByLabelText("Nama lengkap akun baru"), "Nadia Putri");
  await fireEvent.changeText(screen.getByLabelText("Email akun baru"), "Nadia@BGGold.local");
  await fireEvent.changeText(screen.getByLabelText("Nomor karyawan akun baru"), "BG-044");
  await fireEvent.changeText(screen.getByLabelText("Jabatan akun baru"), "Gallery Advisor");
  await fireEvent.changeText(screen.getByLabelText("Kata sandi awal akun baru"), "AmanSekali-2026!");
  await fireEvent.changeText(screen.getByLabelText("Konfirmasi kata sandi akun baru"), "AmanSekali-2026!");
  if (screen.queryByLabelText("PIN absensi akun baru")) {
    await fireEvent.changeText(screen.getByLabelText("PIN absensi akun baru"), "482615");
    await fireEvent.changeText(screen.getByLabelText("Konfirmasi PIN absensi akun baru"), "482615");
  }
}

describe("AccountRegistrationCard", () => {
  beforeEach(() => jest.clearAllMocks());

  it("allows a supervisor to create only an employee account", async () => {
    await render(<AccountRegistrationCard token="supervisor-token" roles={["SUPERVISOR"]} />);
    expect(screen.queryByRole("radio", { name: "Supervisor" })).toBeNull();
    await completeForm();
    await fireEvent.press(screen.getByRole("button", { name: "Buat akun karyawan" }));

    await waitFor(() =>
      expect(api.createEmployee).toHaveBeenCalledWith("supervisor-token", {
        fullName: "Nadia Putri",
        email: "nadia@bggold.local",
        employeeNumber: "BG-044",
        jobTitle: "Gallery Advisor",
        password: "AmanSekali-2026!",
        kioskPIN: "482615",
        roles: ["EMPLOYEE"],
      }),
    );
  });

  it("allows the superadmin to create a supervisor account", async () => {
    await render(<AccountRegistrationCard token="owner-token" roles={["OWNER"]} />);
    await fireEvent.press(screen.getByRole("radio", { name: "Supervisor" }));
    await completeForm();
    await fireEvent.press(screen.getByRole("button", { name: "Buat akun supervisor" }));

    await waitFor(() =>
      expect(api.createEmployee).toHaveBeenCalledWith(
        "owner-token",
        expect.objectContaining({ roles: ["SUPERVISOR"] }),
      ),
    );
  });
});
