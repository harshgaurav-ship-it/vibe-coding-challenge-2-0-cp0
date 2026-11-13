import { ObjectId } from "mongodb";
import { authorize } from "@/lib/auth";
import { withDbTransaction } from "@/lib/db";
import { privateJson, readJson, sameOriginFailure } from "@/lib/http";
import type { AthleteDocument, TeamDocument } from "@/lib/types";
import { sessionSchema } from "@/lib/validation";

type Dependencies = {
  authorize: typeof authorize;
  withDbTransaction: typeof withDbTransaction;
};

export function createOpenSessionHandler(dependencies: Partial<Dependencies> = {}) {
  const authorizeRequest = dependencies.authorize ?? authorize;
  const runTransaction = dependencies.withDbTransaction ?? withDbTransaction;

  return async function POST(request: Request) {
    const originFailure = sameOriginFailure(request);
    if (originFailure) return originFailure;
    const access = await authorizeRequest(["admin", "coach"]);
    if (!access.user) return privateJson({ error: access.error }, access.status);
    const parsedBody = await readJson(request);
    if (!parsedBody.ok) return privateJson({ error: parsedBody.error }, parsedBody.status);
    const parsed = sessionSchema.safeParse(parsedBody.body);
    if (!parsed.success) return privateJson({ error: "Add a valid team, session title, date, and time." }, 400);

    try {
      const organizationId = new ObjectId(access.user.organizationId);
      const created = await runTransaction(async (db, session) => {
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
  };
}
