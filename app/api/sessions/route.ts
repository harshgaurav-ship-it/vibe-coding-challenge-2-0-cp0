import { ObjectId } from "mongodb";
import { authorize } from "@/lib/auth";
import { getDb, withDbTransaction } from "@/lib/db";
import { privateJson, readJson, sameOriginFailure } from "@/lib/http";
import { getAccessibleTeamIds, teamScope } from "@/lib/team-access";
import type { AthleteDocument, SessionDocument, TeamDocument } from "@/lib/types";
import { sessionSchema } from "@/lib/validation";

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

export async function POST(request: Request) {
  const originFailure = sameOriginFailure(request);
  if (originFailure) return originFailure;
  const access = await authorize(["admin", "coach"]);
  if (!access.user) return privateJson({ error: access.error }, access.status);
  const parsedBody = await readJson(request);
  if (!parsedBody.ok) return privateJson({ error: parsedBody.error }, parsedBody.status);
  const parsed = sessionSchema.safeParse(parsedBody.body);
  if (!parsed.success) return privateJson({ error: "Add a valid team, session title, date, and time." }, 400);

  try {
    const organizationId = new ObjectId(access.user.organizationId);
    const created = await withDbTransaction(async (db, session) => {
      const team = await db.collection<TeamDocument>("teams").findOne({ _id: new ObjectId(parsed.data.teamId), organizationId }, { session });
      if (!team) throw Object.assign(new Error("Team not found in this institution."), { status: 404 });
      const isAssigned = access.user!.role === "admin" || (access.user!.role === "coach" && (team.coachIds ?? []).some((id) => String(id) === access.user!.id));
      if (!isAssigned) throw Object.assign(new Error("You are not assigned to this team."), { status: 403 });
      const athletes = await db.collection<AthleteDocument>("athletes").find({ organizationId, teamId: team._id, active: true }, { session }).toArray();
      if (!athletes.length) throw Object.assign(new Error("Add athletes to this team before opening a session."), { status: 409 });
      const duplicate = await db.collection("sessions").findOne({ organizationId, teamId: team._id, date: parsed.data.date, startTime: parsed.data.startTime, title: parsed.data.title }, { session });
      if (duplicate) throw Object.assign(new Error("A session with those details already exists."), { status: 409 });
      const now = new Date();
      const result = await db.collection("sessions").insertOne({
        organizationId, teamId: team._id, teamName: team.name, sport: team.sport,
        title: parsed.data.title, date: parsed.data.date, startTime: parsed.data.startTime,
        status: "open", createdBy: new ObjectId(access.user!.id), createdAt: now,
      }, { session });
      await db.collection("attendance").insertMany(athletes.map((athlete) => ({ organizationId, sessionId: result.insertedId, athleteId: athlete._id, status: "absent", recordedBy: new ObjectId(access.user!.id), updatedAt: now })), { session });
      await db.collection("auditEvents").insertOne({ organizationId, actorId: new ObjectId(access.user!.id), action: "session.opened", entity: "session", entityId: result.insertedId, createdAt: now }, { session });
      return { id: result.insertedId, team, count: athletes.length };
    });
    return privateJson({ session: { id: String(created.id), title: parsed.data.title, teamId: String(created.team._id), team: created.team.name, sport: created.team.sport, date: parsed.data.date, time: parsed.data.startTime, status: "open", attendanceCount: created.count } }, 201);
  } catch (error) {
    if (error && typeof error === "object" && "status" in error) {
      const status = typeof error.status === "number" ? error.status : 400;
      return privateJson({ error: error instanceof Error ? error.message : "The session could not be created." }, status);
    }
    return privateJson({ error: "Unable to open this session." }, 503);
  }
}
