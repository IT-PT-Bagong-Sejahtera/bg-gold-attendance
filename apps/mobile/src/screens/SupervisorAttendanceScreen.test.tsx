import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { api } from "../lib/api";
import { SupervisorAttendanceScreen } from "./SupervisorAttendanceScreen";

jest.mock("../lib/auth", () => ({ useAuth: () => ({ session: { accessToken: "supervisor-token" } }) }));
jest.mock("../lib/api", () => ({ api: {
  me: jest.fn(async () => ({ timezone: "Asia/Jakarta" })),
  supervisorShifts: jest.fn(async () => [{
    id: "event-1", title: "Private Preview", startsAt: "2026-08-14T11:00:00Z", endsAt: "2026-08-14T15:00:00Z", status: "PUBLISHED",
    section: { id: "section-1", name: "Lokasi event" },
    participants: [{ membershipId: "employee-1", employeeName: "Ayu Demo", employeeNumber: "BG-001" }],
  }]),
  employees: jest.fn(async () => [{ id: "employee-1", fullName: "Ayu Demo", email: "ayu@example.com", employeeNumber: "BG-001", status: "ACTIVE", roles: ["EMPLOYEE"] }]),
  sections: jest.fn(async () => [{ id: "section-1", code: "EVENT", name: "Lokasi event", status: "ACTIVE" }]),
  createShift: jest.fn(async () => ({ id: "new-event" })),
} }));

it("shows event participants and publishes a supervisor shift", async () => {
  await render(<SupervisorAttendanceScreen />);
  expect(await screen.findByText("Private Preview")).toBeTruthy();
  expect(screen.getByText("Anggota event · 1 orang")).toBeTruthy();
  expect(screen.getByText("Ayu Demo")).toBeTruthy();

  await fireEvent.press(screen.getByRole("button", { name: "Tambah shift" }));
  await fireEvent.changeText(await screen.findByLabelText("Nama event atau shift"), "Launching koleksi baru");
  await fireEvent.press(screen.getByRole("checkbox"));
  await fireEvent.press(screen.getByRole("button", { name: "Terbitkan shift" }));

  await waitFor(() => expect(api.createShift).toHaveBeenCalledWith(
    "supervisor-token",
    expect.objectContaining({ title: "Launching koleksi baru", sectionId: "section-1", membershipIds: ["employee-1"], publish: true }),
  ));
});
