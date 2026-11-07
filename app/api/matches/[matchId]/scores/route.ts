import { ObjectId } from "mongodb";
import { authorize } from "@/lib/auth";
import { canReceiveMatchScore } from "@/lib/domain";
import { withDbTransaction } from "@/lib/db";
import { privateJson, readJson, sameOriginFailure } from "@/lib/http";
import type { MatchDocument, SessionDocument, TeamDocument } from "@/lib/types";
import { scoreSchema } from "@/lib/validation";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ matchId: string }> }) {
  const originFailure = sameOriginFailure(request);
  if (originFailure) return originFailure;
  const access = await authorize(["admin", "coach"]);
  if (!access.user) return privateJson({ error: access.error }, access.status);
  const { matchId } = await params;
  if (!ObjectId.isValid(matchId)) return privateJson({ error: "Match not found." }, 404);
  const parsedBody = await readJson(request);
  if (!parsedBody.ok) return privateJson({ error: parsedBody.error }, parsedBody.status);
  const parsed = scoreSchema.safeParse(parsedBody.body);
  if (!parsed.success) return privateJson({ error: "Enter an athlete and a valid score from 0 to 10,000." }, 400);

  try {
    const organizationId = new ObjectId(access.user.organizationId);
    const matchObjectId = new ObjectId(matchId);
    const athleteId = new ObjectId(parsed.data.athleteId);
    await withDbTransaction(async (db, session) => {
      const match = await db.collection<MatchDocument>("matches").findOne({ _id: matchObjectId, organizationId }, { session });
      if (!match) throw Object.assign(new Error("Match not found."), { status: 404 });
      const team = await db.collection<TeamDocument>("teams").findOne({ _id: match.teamId, organizationId }, { session });
      if (!team) throw Object.assign(new Error("The match’s team could not be found."), { status: 404 });
      if (access.user!.role === "coach" && !(team.coachIds ?? []).some((id) => String(id) === access.user!.id)) {
        throw Object.assign(new Error("You are not assigned to this team."), { status: 403 });
      }
      const attendanceSession = await db.collection<SessionDocument>("sessions").findOne({
        _id: match.sessionId, organizationId, teamId: match.teamId, status: "closed",
      }, { session });
      if (!attendanceSession) throw Object.assign(new Error("The match’s linked attendance register is unavailable."), { status: 409 });
      const attendance = await db.collection("attendance").findOne({ organizationId, sessionId: attendanceSession._id, athleteId }, { session });
      if (!canReceiveMatchScore(attendanceSession.status, attendance?.status ?? null)) {
        throw Object.assign(new Error("Only athletes marked Present in this match’s linked closed register can receive a score."), { status: 403 });
      }
      const now = new Date();
      await db.collection("matchScores").updateOne(
        { organizationId, matchId: match._id, athleteId },
        { $set: { organizationId, matchId: match._id, athleteId, score: parsed.data.score, recordedBy: new ObjectId(access.user!.id), updatedAt: now } },
        { upsert: true, session },
      );
      await db.collection("auditEvents").insertOne({ organizationId, actorId: new ObjectId(access.user!.id), action: "match.score_saved", entity: "matchScore", entityId: match._id, details: { athleteId, score: parsed.data.score }, createdAt: now }, { session });
    });
    return privateJson({ ok: true, score: { athleteId: parsed.data.athleteId, value: parsed.data.score } });
  } catch (error) {
    if (error && typeof error === "object" && "status" in error) {
      const status = typeof error.status === "number" ? error.status : 400;
      return privateJson({ error: error instanceof Error ? error.message : "The score could not be saved." }, status);
    }
    return privateJson({ error: "Unable to save the match score." }, 503);
  }
}
