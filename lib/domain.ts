import type { AttendanceStatus, SessionStatus } from "@/lib/types";

export function attendanceRate(present: number, total: number) {
  return total > 0 ? Math.round((present / total) * 100) : 0;
}

export function isTrialReady(present: number, total: number, matches: number) {
  return total > 0 && present / total >= 0.75 && matches >= 2;
}

export function canReceiveMatchScore(sessionStatus: SessionStatus | null, attendance: AttendanceStatus | null) {
  return sessionStatus === "closed" && attendance === "present";
}
