import { strFromU8, unzipSync } from "fflate";
import type { SupervisorAttendanceReport } from "./api";

jest.mock("expo-file-system/legacy", () => ({
  cacheDirectory: "file:///cache/",
  EncodingType: { Base64: "base64" },
  writeAsStringAsync: jest.fn(),
}));
jest.mock("expo-sharing", () => ({
  isAvailableAsync: jest.fn(async () => true),
  shareAsync: jest.fn(),
}));

const { buildAttendanceWorkbook } = require("./exportAttendanceExcel") as typeof import("./exportAttendanceExcel");

it("builds a real OOXML workbook containing every employee", () => {
  const report: SupervisorAttendanceReport = {
    date: "2026-08-12",
    generatedAt: "2026-08-13T02:00:00Z",
    organizationName: "BG GOLD",
    rows: [
      {
        membershipId: "employee-1",
        employeeName: "Ayu Demo",
        employeeNumber: "BG-01",
        sectionName: "Flagship",
        shiftTitle: "Pagi",
        shiftStartsAt: "2026-08-12T02:00:00Z",
        shiftEndsAt: "2026-08-12T10:00:00Z",
        clockInAt: "2026-08-12T01:55:00Z",
        clockOutAt: "2026-08-12T10:05:00Z",
        workMinutes: 490,
        status: "ON_TIME",
      },
    ],
  };

  const files = unzipSync(buildAttendanceWorkbook(report));
  expect(Object.keys(files)).toEqual(
    expect.arrayContaining([
      "[Content_Types].xml",
      "xl/workbook.xml",
      "xl/styles.xml",
      "xl/worksheets/sheet1.xml",
      "xl/worksheets/sheet2.xml",
    ]),
  );
  expect(strFromU8(files["xl/workbook.xml"]!)).toContain("Semua Karyawan");
  const details = strFromU8(files["xl/worksheets/sheet2.xml"]!);
  expect(details).toContain("Ayu Demo");
  expect(details).toContain("BG-01");
  expect(details).toContain("Tepat waktu");
  expect(details).toContain('autoFilter ref="A1:K2"');
});
