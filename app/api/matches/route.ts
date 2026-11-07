import { ObjectId } from "mongodb";
import { authorize } from "@/lib/auth";
import { getDb, withDbTransaction } from "@/lib/db";
import { privateJson, readJson, sameOriginFailure } from "@/lib/http";
import { canManageTeam, getAccessibleTeamIds, teamScope } from "@/lib/team-access";
import type { MatchDocument, SessionDocument, TeamDocument } from "@/lib/types";
import { matchSchema } from "@/lib/validation";

export const runtime = "nodejs";

export async function GET() {
  const access = await authorize(["admin", "coach", "player"]);
  if (!access.user) return privateJson({ error: access.error }, access.status);
  try {
    const db = await getDb();
    const organizationId = new ObjectId(access.user.organizationId);
    const teamIds = await getAccessibleTeamIds(db, access.user);
    const query = { organizationId, ...teamScope(teamIds) };
    const matches = await db.collection<MatchDocument>("matches").find(query).sort({ date: -1, createdAt: -1 }).limit(100).toArray();
    return privateJson({ matches: matches.map((match) => ({ id: String(match._id), sessionId: String(match.sessionId), teamId: String(match.teamId), team: match.teamName, sport: match.sport, opponent: match.opponent, date: match.date, time: match.startTime })) });
  } catch {
    return privateJson({ error: "Unable to load matches." }, 503);
  }
}

export async function POST(request: Request) {
  const originFailure = sameOriginFailure(request);
  if (originFailure) return originFailure;
  const access = await authorize(["admin", "coach"]);
  if (!access.user) return privateJson({ error: access.error }, access.status);
  const parsedBody = await readJson(request);
  if (!parsedBody.ok) return privateJson({ error: parsedBody.error }, parsedBody.status);
  const parsed = matchSchema.safeParse(parsedBody.body);
  if (!parsed.success) return privateJson({ error: "Choose a closed attendance session, opponent, and start time." }, 400);

  try {
    const organizationId = new ObjectId(access.user.organizationId);
    const sessionId = new ObjectId(parsed.data.sessionId);
    const matchId = await withDbTransaction(async (db, mongoSession) => {
      const attendanceSession = await db.collection<SessionDocument>("sessions").findOne({ _id: sessionId, organizationId, status: "closed" }, { session: mongoSession });
      if (!attendanceSession) throw Object.assign(new Error("Choose a closed attendance register for this match."), { status: 409 });
      const team = await db.collection<TeamDocument>("teams").findOne({ _id: attendanceSession.teamId, organizationId }, { session: mongoSession });
      if (!team) throw Object.assign(new Error("The session’s team could not be found."), { status: 404 });
      if (!canManageTeam(access.user!, team)) throw Object.assign(new Error("You are not assigned to this team."), { status: 403 });
      const duplicate = await db.collection<MatchDocument>("matches").findOne({ organizationId, teamId: team._id, opponent: parsed.data.opponent, date: attendanceSession.date }, { session: mongoSession });
      if (duplicate) throw Object.assign(new Error("That team already has a fixture against this opponent on this date."), { status: 409 });
      const result = await db.collection("matches").insertOne({
        organizationId, sessionId: attendanceSession._id, teamId: team._id,
        teamName: team.name, sport: team.sport, opponent: parsed.data.opponent,
        date: attendanceSession.date, startTime: parsed.data.startTime,
        createdBy: new ObjectId(access.user!.id), createdAt: new Date(),
      }, { session: mongoSession });
      await db.collection("auditEvents").insertOne({ organizationId, actorId: new ObjectId(access.user!.id), action: "match.created", entity: "match", entityId: result.insertedId, details: { sessionId }, createdAt: new Date() }, { session: mongoSession });
      return result.insertedId;
    });
    return privateJson({ match: { id: String(matchId), sessionId: String(sessionId), opponent: parsed.data.opponent } }, 201);
  } catch (error) {
    if (error && typeof error === "object" && "status" in error) {
      const status = typeof error.status === "number" ? error.status : 400;
      return privateJson({ error: error instanceof Error ? error.message : "The match could not be created." }, status);
    }
    if (error && typeof error === "object" && "code" in error && error.code === 11000) return privateJson({ error: "That team already has a fixture against this opponent on this date." }, 409);
    return privateJson({ error: "Unable to create the match." }, 503);
  }
}
