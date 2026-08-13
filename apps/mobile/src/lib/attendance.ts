import type {
  AttendanceAction,
  AttendanceEventAction,
  AttendanceState,
} from "./api";

export function primaryAttendanceAction(state: AttendanceState): AttendanceAction | null {
  if (state === "NOT_STARTED") return "CLOCK_IN";
  if (state === "WORKING") return "CLOCK_OUT";
  return null;
}

export function actionLabel(action: AttendanceEventAction): string {
  return {
    CLOCK_IN: "Clock in",
    CLOCK_OUT: "Clock out",
    START_BREAK: "Mulai istirahat",
    END_BREAK: "Selesai istirahat",
    WORK_MORE: "Kerja tambahan",
    AUTO_CLOCK_OUT: "Clock out otomatis",
    CORRECTION: "Koreksi absensi",
  }[action];
}

export function optimisticAttendanceState(action: AttendanceAction) {
  return action === "CLOCK_OUT"
    ? "COMPLETED"
    : action === "START_BREAK"
      ? "ON_BREAK"
      : "WORKING";
}
