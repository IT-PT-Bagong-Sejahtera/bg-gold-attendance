import {
  APIError,
  api,
  request,
  setAccessTokenRenewalHandler,
} from "./api";

function response(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: jest.fn().mockResolvedValue(body),
  } as unknown as Response;
}

describe("API access-token renewal", () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    globalThis.fetch = fetchMock as typeof fetch;
    setAccessTokenRenewalHandler(null);
  });

  afterEach(() => setAccessTokenRenewalHandler(null));

  it("renews after one 401 and retries with the replacement token", async () => {
    fetchMock
      .mockResolvedValueOnce(
        response(401, {
          error: { code: "SESSION_EXPIRED", message: "Sesi kedaluwarsa." },
        }),
      )
      .mockResolvedValueOnce(response(200, { data: { id: "member-1" } }));
    const renew = jest.fn().mockResolvedValue("fresh-access-token");
    setAccessTokenRenewalHandler(renew);

    await expect(
      request<{ id: string }>("/me", {}, "expired-access-token"),
    ).resolves.toEqual({ id: "member-1" });

    expect(renew).toHaveBeenCalledWith("expired-access-token");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({
      Authorization: "Bearer expired-access-token",
    });
    expect(fetchMock.mock.calls[1]?.[1]?.headers).toMatchObject({
      Authorization: "Bearer fresh-access-token",
    });
  });

  it("deduplicates concurrent refresh attempts to protect token rotation", async () => {
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit | undefined) => {
        const headers = init?.headers as Record<string, string> | undefined;
        return Promise.resolve(
          headers?.Authorization === "Bearer expired-access-token"
            ? response(401, {
                error: {
                  code: "SESSION_EXPIRED",
                  message: "Sesi kedaluwarsa.",
                },
              })
            : response(200, { data: { ok: true } }),
        );
      },
    );
    const renew = jest
      .fn<Promise<string | null>, [string]>()
      .mockResolvedValue("fresh-access-token");
    setAccessTokenRenewalHandler(renew);

    await expect(
      Promise.all([
        request("/me", {}, "expired-access-token"),
        request("/me/notifications", {}, "expired-access-token"),
      ]),
    ).resolves.toEqual([{ ok: true }, { ok: true }]);

    expect(renew).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("returns the original authorization error when renewal fails", async () => {
    fetchMock.mockResolvedValue(
      response(401, {
        error: { code: "SESSION_EXPIRED", message: "Sesi kedaluwarsa." },
      }),
    );
    setAccessTokenRenewalHandler(
      jest.fn().mockRejectedValue(new Error("refresh rejected")),
    );

    await expect(
      request("/me", {}, "expired-access-token"),
    ).rejects.toMatchObject<Partial<APIError>>({
      status: 401,
      code: "SESSION_EXPIRED",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("also renews multipart attachment uploads without forcing JSON headers", async () => {
    fetchMock
      .mockResolvedValueOnce(
        response(401, {
          error: { code: "SESSION_EXPIRED", message: "Sesi kedaluwarsa." },
        }),
      )
      .mockResolvedValueOnce(
        response(200, {
          data: { id: "attachment-1", contentType: "image/jpeg", sizeBytes: 5 },
        }),
      );
    setAccessTokenRenewalHandler(
      jest.fn().mockResolvedValue("fresh-access-token"),
    );

    await expect(
      api.selfie("expired-access-token", "file:///receipt.jpg"),
    ).resolves.toMatchObject({ id: "attachment-1" });

    expect(fetchMock.mock.calls[1]?.[1]?.headers).toEqual({
      Authorization: "Bearer fresh-access-token",
    });
  });

  it("removes display-only evidence fields from production attendance JSON", async () => {
    fetchMock.mockResolvedValueOnce(response(201, {
      data: { actionId: "event-1", attendanceState: "WORKING" },
    }));

    await api.action("production-token", "attendance-key", {
      type: "CLOCK_IN",
      sectionId: "section-1",
      evidence: {
        employeeName: "Nama dari UI",
        selectedLocationName: "Nama showroom dari UI",
        deviceId: "device-1",
        location: { latitude: -6.2, longitude: 106.8, accuracyMeters: 8, capturedAt: "2026-08-14T05:00:00Z" },
      },
    });

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body).toMatchObject({
      type: "CLOCK_IN",
      sectionId: "section-1",
      evidence: { deviceId: "device-1", location: { latitude: -6.2 } },
    });
    expect(body.evidence).not.toHaveProperty("employeeName");
    expect(body.evidence).not.toHaveProperty("selectedLocationName");
  });
});
