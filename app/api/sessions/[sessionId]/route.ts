import { ObjectId } from "mongodb";
import { authorize } from "@/lib/auth";
import { withDbTransaction } from "@/lib/db";
import { privateJson, readJson, sameOriginFailure } from "@/lib/http";
import type { SessionDocument, TeamDocument } from "@/lib/types";
import { attendanceSchema } from "@/lib/validation";

export const runtime = "nodejs";

export async function PATCH(request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  const originFailure = sameOriginFailure(request);
  if (originFailure) return originFailure;
  const access = await authorize(["admin", "coach"]);
  if (!access.user) return privateJson({ error: access.error }, access.status);
  const { sessionId } = await params;
  if (!ObjectId.isValid(sessionId)) return privateJson({ error: "Session not found." }, 404);
  const parsedBody = await readJson(request);
  if (!parsedBody.ok) return privateJson({ error: parsedBody.error }, parsedBody.status);
  const parsed = attendanceSchema.safeParse(parsedBody.body);
  if (!parsed.success || (parsed.data.action === "mark" && (!parsed.data.athleteId || !parsed.data.status))) {
    return privateJson({ error: "Choose a valid attendance action and player status." }, 400);
  }

  try {
    const organizationId = new ObjectId(access.user.organizationId);
    const sessionIdObject = new ObjectId(sessionId);
    const actorId = new ObjectId(access.user.id);
    const response = await withDbTransaction(async (db, mongoSession) => {
      const session = await db.collection<SessionDocument>("sessions").findOne({ _id: sessionIdObject, organizationId }, { session: mongoSession });
      if (!session) return { status: 404, body: { error: "Session not found." } };
      const team = await db.collection<TeamDocument>("teams").findOne({ _id: session.teamId, organizationId }, { session: mongoSession });
      if (!team || (access.user!.role === "coach" && !(team.coachIds ?? []).some((id) => String(id) === access.user!.id))) {
        return { status: 403, body: { error: "You are not assigned to this team." } };
      }
      if (session.status === "closed") return { status: 409, body: { error: "This session is locked and cannot be edited." } };

      if (parsed.data.action === "close") {
        const update = await db.collection<SessionDocument>("sessions").updateOne(
          { _id: session._id, organizationId, status: "open" },
          { $set: { status: "closed", closedAt: new Date(), closedBy: actorId } },
          { session: mongoSession },
        );
        if (update.modifiedCount !== 1) return { status: 409, body: { error: "This session changed while you were reviewing it. Refresh and try again." } };
        await db.collection("auditEvents").insertOne({ organizationId, actorId, action: "session.closed", entity: "session", entityId: session._id, createdAt: new Date() }, { session: mongoSession });
        return { status: 200, body: { ok: true, status: "closed" } };
      }

      const athleteId = new ObjectId(parsed.data.athleteId!);
      const attendance = await db.collection("attendance").findOne({ organizationId, sessionId: session._id, athleteId }, { session: mongoSession });
      if (!attendance) return { status: 403, body: { error: "This athlete is not part of the session roster." } };
      await db.collection("attendance").updateOne(
        { _id: attendance._id, organizationId },
        { $set: { status: parsed.data.status, recordedBy: actorId, updatedAt: new Date() } },
        { session: mongoSession },
      );
      await db.collection("auditEvents").insertOne({ organizationId, actorId, action: "attendance.updated", entity: "attendance", entityId: attendance._id, details: { sessionId: session._id, athleteId, status: parsed.data.status }, createdAt: new Date() }, { session: mongoSession });
      return { status: 200, body: { ok: true, status: parsed.data.status } };
    });
    return privateJson(response.body, response.status);
  } catch {
    return privateJson({ error: "Unable to update this session." }, 503);
  }
}
