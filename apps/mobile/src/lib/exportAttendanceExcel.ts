import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { strToU8, zipSync } from "fflate";
import type {
  SupervisorAttendanceReport,
  SupervisorAttendanceReportStatus,
} from "./api";

const EXCEL_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const STATUS_LABELS: Record<SupervisorAttendanceReportStatus, string> = {
  ON_TIME: "Tepat waktu",
  LATE: "Terlambat",
  ABSENT: "Tidak hadir",
  LEAVE: "Cuti",
  WORKING: "Sedang bekerja",
};
type Cell = string | number;

export async function exportSupervisorAttendanceExcel(
  report: SupervisorAttendanceReport,
) {
  if (!FileSystem.cacheDirectory) {
    throw new Error("Penyimpanan sementara perangkat tidak tersedia.");
  }

  const archive = buildAttendanceWorkbook(report);

  const fileName = `Rekap-Absensi-BG-GOLD-${report.date}.xlsx`;
  const fileUri = `${FileSystem.cacheDirectory}${fileName}`;
  await FileSystem.writeAsStringAsync(fileUri, bytesToBase64(archive), {
    encoding: FileSystem.EncodingType.Base64,
  });
  if (!(await Sharing.isAvailableAsync())) {
    throw new Error("Dialog ekspor tidak tersedia di perangkat ini.");
  }
  await Sharing.shareAsync(fileUri, {
    dialogTitle: "Simpan atau bagikan rekap absensi",
    mimeType: EXCEL_MIME,
    UTI: "org.openxmlformats.spreadsheetml.sheet",
  });
  return { fileName, fileUri };
}

export function buildAttendanceWorkbook(report: SupervisorAttendanceReport) {
  const totals = {
    employees: report.rows.length,
    present: report.rows.filter((row) =>
      ["ON_TIME", "LATE", "WORKING"].includes(row.status),
    ).length,
    late: report.rows.filter((row) => row.status === "LATE").length,
    absent: report.rows.filter((row) => row.status === "ABSENT").length,
    leave: report.rows.filter((row) => row.status === "LEAVE").length,
  };
  const summary: Cell[][] = [
    ["REKAP ABSENSI BG GOLD", ""],
    ["Organisasi", report.organizationName],
    ["Tanggal", report.date],
    ["Dibuat", formatDateTime(report.generatedAt)],
    [],
    ["Ringkasan", "Jumlah"],
    ["Semua karyawan", totals.employees],
    ["Hadir", totals.present],
    ["Terlambat", totals.late],
    ["Tidak hadir", totals.absent],
    ["Cuti", totals.leave],
  ];
  const details: Cell[][] = [
    [
      "No",
      "Nomor karyawan",
      "Nama karyawan",
      "Outlet",
      "Shift",
      "Jadwal masuk",
      "Jadwal pulang",
      "Clock in",
      "Clock out",
      "Durasi kerja",
      "Status",
    ],
    ...report.rows.map((row, index) => [
      index + 1,
      row.employeeNumber,
      row.employeeName,
      row.sectionName,
      row.shiftTitle,
      formatTime(row.shiftStartsAt),
      formatTime(row.shiftEndsAt),
      row.clockInAt ? formatTime(row.clockInAt) : "-",
      row.clockOutAt ? formatTime(row.clockOutAt) : "-",
      formatDuration(row.workMinutes),
      STATUS_LABELS[row.status],
    ]),
  ];

  return zipSync({
    "[Content_Types].xml": xml(CONTENT_TYPES),
    "_rels/.rels": xml(ROOT_RELATIONSHIPS),
    "docProps/app.xml": xml(APP_PROPERTIES),
    "docProps/core.xml": xml(coreProperties(report.generatedAt)),
    "xl/workbook.xml": xml(WORKBOOK),
    "xl/_rels/workbook.xml.rels": xml(WORKBOOK_RELATIONSHIPS),
    "xl/styles.xml": xml(STYLES),
    "xl/worksheets/sheet1.xml": xml(
      worksheet(summary, [25, 38], { headerRows: [6], titleRows: [1], merge: "A1:B1" }),
    ),
    "xl/worksheets/sheet2.xml": xml(
      worksheet(details, [6, 18, 24, 24, 24, 16, 16, 14, 14, 16, 18], {
        headerRows: [1],
        autoFilter: `A1:K${details.length}`,
      }),
    ),
  });

}

export function attendanceStatusLabel(status: SupervisorAttendanceReportStatus) {
  return STATUS_LABELS[status];
}

function worksheet(
  rows: Cell[][],
  widths: number[],
  options: {
    headerRows?: number[];
    titleRows?: number[];
    merge?: string;
    autoFilter?: string;
  } = {},
) {
  const columns = widths
    .map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`)
    .join("");
  const body = rows
    .map((row, rowIndex) => {
      const number = rowIndex + 1;
      const style = options.titleRows?.includes(number)
        ? 2
        : options.headerRows?.includes(number)
          ? 1
          : 0;
      const cells = row
        .map((value, columnIndex) => cell(value, `${columnName(columnIndex)}${number}`, style))
        .join("");
      return `<row r="${number}">${cells}</row>`;
    })
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"/></sheetViews><cols>${columns}</cols><sheetData>${body}</sheetData>${options.autoFilter ? `<autoFilter ref="${options.autoFilter}"/>` : ""}${options.merge ? `<mergeCells count="1"><mergeCell ref="${options.merge}"/></mergeCells>` : ""}</worksheet>`;
}

function cell(value: Cell, reference: string, style: number) {
  const styleAttribute = style ? ` s="${style}"` : "";
  if (typeof value === "number") {
    return `<c r="${reference}"${styleAttribute}><v>${value}</v></c>`;
  }
  return `<c r="${reference}" t="inlineStr"${styleAttribute}><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
}

function columnName(index: number) {
  let name = "";
  for (let current = index + 1; current > 0; current = Math.floor((current - 1) / 26)) {
    name = String.fromCharCode(((current - 1) % 26) + 65) + name;
  }
  return name;
}

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function bytesToBase64(bytes: Uint8Array) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let output = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] ?? 0;
    const second = bytes[index + 1] ?? 0;
    const third = bytes[index + 2] ?? 0;
    const combined = (first << 16) | (second << 8) | third;
    output += alphabet[(combined >> 18) & 63];
    output += alphabet[(combined >> 12) & 63];
    output += index + 1 < bytes.length ? alphabet[(combined >> 6) & 63] : "=";
    output += index + 2 < bytes.length ? alphabet[combined & 63] : "=";
  }
  return output;
}

function xml(value: string) {
  return strToU8(value);
}

function formatTime(instant: string) {
  return new Intl.DateTimeFormat("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Jakarta",
  }).format(new Date(instant));
}

function formatDateTime(instant: string) {
  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "Asia/Jakarta",
  }).format(new Date(instant));
}

function formatDuration(minutes: number) {
  if (minutes <= 0) return "-";
  return `${Math.floor(minutes / 60)}j ${minutes % 60}m`;
}

function coreProperties(generatedAt: string) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>Rekap Absensi BG GOLD</dc:title><dc:creator>Absen BG</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${escapeXml(generatedAt)}</dcterms:created></cp:coreProperties>`;
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`;
const ROOT_RELATIONSHIPS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`;
const APP_PROPERTIES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>Absen BG</Application></Properties>`;
const WORKBOOK = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Ringkasan" sheetId="1" r:id="rId1"/><sheet name="Semua Karyawan" sheetId="2" r:id="rId2"/></sheets></workbook>`;
const WORKBOOK_RELATIONSHIPS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="3"><font><sz val="11"/><name val="Aptos"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Aptos"/></font><font><b/><color rgb="FFD5AE38"/><sz val="16"/><name val="Aptos Display"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF28120D"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="0" fontId="2" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
