import { z } from "zod";

const calendarDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const timestamp = Date.parse(value + "T00:00:00.000Z");
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
});
const clockTime = z.string().regex(/^\d{2}:\d{2}$/).refine((value) => {
  const [hours, minutes] = value.split(":").map(Number);
  return hours <= 23 && minutes <= 59;
});

export const loginSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(128),
});

export const athleteSchema = z.object({
  name: z.string().trim().min(2).max(100),
  age: z.number().int().min(5).max(100),
  studentId: z.string().trim().min(2).max(40),
  sport: z.string().trim().min(2).max(50),
  teamId: z.string().regex(/^[a-f\d]{24}$/i),
  year: z.string().trim().min(1).max(40),
  joinedAt: calendarDate,
  email: z.string().trim().email().max(254).optional().or(z.literal("")),
  password: z.string().min(12).max(128).optional().or(z.literal("")),
});

export const sessionSchema = z.object({
  teamId: z.string().regex(/^[a-f\d]{24}$/i),
  title: z.string().trim().min(2).max(100),
  date: calendarDate,
  startTime: clockTime,
});

export const attendanceSchema = z.object({
  action: z.enum(["mark", "markAll", "close"]),
  athleteId: z.string().regex(/^[a-f\d]{24}$/i).optional(),
  status: z.enum(["present", "absent"]).optional(),
});

export const matchSchema = z.object({
  sessionId: z.string().regex(/^[a-f\d]{24}$/i),
  date: calendarDate,
  sport: z.string().trim().min(2).max(50),
  opponent: z.string().trim().min(2).max(100),
  startTime: clockTime,
});

export const scoreSchema = z.object({
  athleteId: z.string().regex(/^[a-f\d]{24}$/i),
  score: z.number().finite().min(0).max(10000),
});
