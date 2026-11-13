import { ObjectId } from "mongodb";
import { authorize } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { privateJson } from "@/lib/http";
import { getAccessibleTeamIds, teamScope } from "@/lib/team-access";
import type { AthleteDocument, SessionDocument } from "@/lib/types";
import { createOpenSessionHandler } from "@/lib/route-handlers/open-session";

export const runtime = "nodejs";

export async function GET() {
  const access = await authorize(["admin", "coach", "player"]);
  if (!access.user) return privateJson({ error: access.error }, access.status);
  try {
    const db = await getDb();
    const organizationId = new ObjectId(access.user.organizationId);
    const teamIds = await getAccessibleTeamIds(db, access.user);
    const sessions = await db.collection<SessionDocument>("sessions").find({ organizationId, ...teamScope(teamIds) }).sort({ date: -1, createdAt: -1 }).limit(100).toArray();
    const athleteIds = new Set<string>();
    const attendanceRows = sessions.length
      ? await db.collection("attendance").find({ organizationId, sessionId: { $in: sessions.map((session) => session._id) } }).toArray()
      : [];
    for (const row of attendanceRows) athleteIds.add(String(row.athleteId));
    const athletes = athleteIds.size
      ? await db.collection<AthleteDocument>("athletes").find({ organizationId, _id: { $in: [...athleteIds].map((id) => new ObjectId(id)) } }).toArray()
      : [];
    const athleteById = new Map(athletes.map((athlete) => [String(athlete._id), athlete]));
    const attendanceBySession = new Map<string, typeof attendanceRows>();
    for (const row of attendanceRows) attendanceBySession.set(String(row.sessionId), [...(attendanceBySession.get(String(row.sessionId)) ?? []), row]);
    const visible = access.user.role === "player"
      ? access.user.athleteId
        ? sessions.filter((session) => (attendanceBySession.get(String(session._id)) ?? []).some((row) => String(row.athleteId) === access.user?.athleteId))
        : []
      : sessions;
    return privateJson({ sessions: visible.map((session) => ({
      id: String(session._id),
      title: session.title,
      teamId: String(session.teamId),
      team: session.teamName,
      sport: session.sport,
      date: session.date,
      time: session.startTime,
      status: session.status,
      attendance: (attendanceBySession.get(String(session._id)) ?? []).flatMap((row) => {
        if (access.user?.role === "player" && String(row.athleteId) !== access.user.athleteId) return [];
        const athlete = athleteById.get(String(row.athleteId));
        return athlete && (access.user?.role !== "player" || String(athlete._id) === access.user.athleteId)
          ? [{ athleteId: String(athlete._id), name: athlete.name, studentId: athlete.studentId, status: row.status }]
          : [];
      }),
    })) });
  } catch {
    return privateJson({ error: "Unable to load sessions." }, 503);
  }
}

export const POST = createOpenSessionHandler();
