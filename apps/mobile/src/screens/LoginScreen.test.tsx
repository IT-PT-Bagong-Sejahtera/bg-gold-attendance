import { fireEvent, render, screen } from "@testing-library/react-native";
import * as SecureStore from "expo-secure-store";
import { Linking } from "react-native";
import { AuthProvider } from "../lib/auth";
import { LoginScreen } from "./LoginScreen";

jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));
jest.mock("@react-native-async-storage/async-storage", () => ({
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => undefined),
}));

describe("LoginScreen", () => {
  beforeEach(() => {
    jest.spyOn(Linking, "getInitialURL").mockResolvedValue(null);
    globalThis.fetch = jest.fn(async () => ({
      ok: false,
      status: 401,
      json: async () => ({
        error: {
          code: "INVALID_CREDENTIALS",
          message: "Email atau kata sandi tidak sesuai.",
        },
      }),
    })) as unknown as typeof fetch;
  });

  afterEach(() => jest.restoreAllMocks());

  it("shows the BG GOLD login flow and an inline recoverable API error", async () => {
    await render(
      <AuthProvider>
        <LoginScreen />
      </AuthProvider>,
    );
    expect(screen.getByText("Mulai hari kerja dengan jelas.")).toBeTruthy();
    await fireEvent.changeText(
      screen.getByLabelText("Email"),
      "employee@bggold.local",
    );
    await fireEvent.changeText(
      screen.getByLabelText("Kata sandi"),
      "incorrect-password",
    );
    await fireEvent.press(screen.getByRole("button", { name: "Masuk" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Email atau kata sandi tidak sesuai.",
    );
  });

  it("stores a successful session in secure device storage", async () => {
    const session = {
      accessToken: "access-token",
      accessExpiresAt: "2026-08-11T02:00:00Z",
      refreshToken: "refresh-token",
      refreshExpiresAt: "2026-09-11T02:00:00Z",
    };
    globalThis.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: session }),
    })) as unknown as typeof fetch;

    await render(
      <AuthProvider>
        <LoginScreen />
      </AuthProvider>,
    );
    await fireEvent.changeText(
      screen.getByLabelText("Email"),
      "ayu@bggold.local",
    );
    await fireEvent.changeText(
      screen.getByLabelText("Kata sandi"),
      "Ayu-Password-2026!",
    );
    await fireEvent.press(screen.getByRole("button", { name: "Masuk" }));

    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
      "bg-gold.attendance.session",
      JSON.stringify(session),
    );
  });

  it("enters a persistent local demo without contacting the server", async () => {
    await render(
      <AuthProvider>
        <LoginScreen />
      </AuthProvider>,
    );

    await fireEvent.press(
      screen.getByRole("button", { name: "Coba demo tanpa server" }),
    );

    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
      "bg-gold.attendance.session",
      expect.stringContaining("bg-gold-local-demo-access"),
    );
    expect(
      screen.getByText(
        "Setiap peran memakai data contoh lokal yang aman untuk dicoba.",
      ),
    ).toBeTruthy();
  });

  it("offers and stores a separate supervisor demo session", async () => {
    await render(
      <AuthProvider>
        <LoginScreen />
      </AuthProvider>,
    );

    await fireEvent.press(
      screen.getByRole("button", {
        name: "Coba demo supervisor tanpa server",
      }),
    );

    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
      "bg-gold.attendance.session",
      expect.stringContaining("bg-gold-local-demo-supervisor-access"),
    );
  });

  it("requires kiosk activation from the supervisor profile", async () => {
    await render(
      <AuthProvider>
        <LoginScreen />
      </AuthProvider>,
    );

    expect(screen.queryByRole("button", { name: "Masuk demo showroom satu HP" })).toBeNull();
    expect(screen.getByText("Kelola tim, showroom, dan aktifkan kiosk 1 HP")).toBeTruthy();
  });

  it("completes the local password recovery flow", async () => {
    const resetToken = "local-test-token-with-more-than-forty-characters";
    globalThis.fetch = jest.fn(async (input) => {
      const url = String(input);
      if (url.endsWith("/auth/password/forgot")) {
        return {
          ok: true,
          status: 202,
          json: async () => ({
            data: {
              message: "Jika akun ditemukan, petunjuk reset akan dikirim.",
              developmentResetToken: resetToken,
            },
          }),
        };
      }
      if (url.endsWith("/auth/password/reset")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              message: "Kata sandi berhasil diperbarui. Silakan masuk kembali.",
            },
          }),
        };
      }
      throw new Error(`Unexpected URL: ${url}`);
    }) as unknown as typeof fetch;

    await render(
      <AuthProvider>
        <LoginScreen />
      </AuthProvider>,
    );
    await fireEvent.press(
      await screen.findByRole("button", { name: "Lupa kata sandi?" }),
    );
    expect(await screen.findByText("Pulihkan akses Anda.")).toBeTruthy();
    await fireEvent.changeText(
      screen.getByLabelText("Email"),
      "ayu@bggold.local",
    );
    await fireEvent.press(
      screen.getByRole("button", { name: "Kirim petunjuk" }),
    );

    expect(await screen.findByDisplayValue(resetToken)).toBeTruthy();
    await fireEvent.changeText(
      screen.getByLabelText("Kata sandi baru"),
      "Baru1234",
    );
    await fireEvent.changeText(
      screen.getByLabelText("Ulangi kata sandi baru"),
      "Baru1234",
    );
    await fireEvent.press(
      screen.getByRole("button", { name: "Perbarui kata sandi" }),
    );

    expect(
      await screen.findByText(
        "Kata sandi berhasil diperbarui. Silakan masuk kembali.",
      ),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Masuk" })).toBeTruthy();
  });

  it("opens a production reset email deep link directly in reset mode", async () => {
    const resetToken = "email-reset-token-with-more-than-forty-characters";
    jest
      .spyOn(Linking, "getInitialURL")
      .mockResolvedValue(
        `bggold-attendance://reset-password?token=${resetToken}`,
      );

    await render(
      <AuthProvider>
        <LoginScreen />
      </AuthProvider>,
    );

    expect(await screen.findByText("Buat kata sandi baru.")).toBeTruthy();
    expect(screen.getByDisplayValue(resetToken)).toBeTruthy();
    expect(
      screen.getByText("Tautan reset diterima. Buat kata sandi baru Anda."),
    ).toBeTruthy();
  });
});
