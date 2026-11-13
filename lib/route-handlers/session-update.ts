import { ObjectId } from "mongodb";
import { authorize } from "@/lib/auth";
import { withDbTransaction } from "@/lib/db";
import { privateJson, readJson, sameOriginFailure } from "@/lib/http";
import type { SessionDocument, TeamDocument } from "@/lib/types";
import { attendanceSchema } from "@/lib/validation";

type Dependencies = {
  authorize: typeof authorize;
  withDbTransaction: typeof withDbTransaction;
};

export function createSessionUpdateHandler(dependencies: Partial<Dependencies> = {}) {
  const authorizeRequest = dependencies.authorize ?? authorize;
  const runTransaction = dependencies.withDbTransaction ?? withDbTransaction;

  return async function PATCH(request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
    const originFailure = sameOriginFailure(request);
    if (originFailure) return originFailure;
    const access = await authorizeRequest(["admin", "coach"]);
    if (!access.user) return privateJson({ error: access.error }, access.status);
    const { sessionId } = await params;
    if (!ObjectId.isValid(sessionId)) return privateJson({ error: "Session not found." }, 404);
    const parsedBody = await readJson(request);
    if (!parsedBody.ok) return privateJson({ error: parsedBody.error }, parsedBody.status);
    const parsed = attendanceSchema.safeParse(parsedBody.body);
    if (!parsed.success || ((parsed.data.action === "mark" || parsed.data.action === "markAll") && !parsed.data.status) || (parsed.data.action === "mark" && !parsed.data.athleteId)) {
      return privateJson({ error: "Choose a valid attendance action and player status." }, 400);
    }

    try {
      const organizationId = new ObjectId(access.user.organizationId);
      const sessionIdObject = new ObjectId(sessionId);
      const actorId = new ObjectId(access.user.id);
      const response = await runTransaction(async (db, mongoSession) => {
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
          return { status: 200, body: { ok: true, status: "closed" } };
        }

        if (parsed.data.action === "markAll") {
          const status = parsed.data.status;
          if (!status) return { status: 400, body: { error: "Choose a valid player status." } };
          const now = new Date();
          const update = await db.collection("attendance").updateMany(
            { organizationId, sessionId: session._id, status: { $ne: status } },
            { $set: { status, recordedBy: actorId, updatedAt: now } },
            { session: mongoSession },
          );
          return { status: 200, body: { ok: true, status, updated: update.modifiedCount } };
        }

        const athleteId = new ObjectId(parsed.data.athleteId!);
        const attendance = await db.collection("attendance").findOne({ organizationId, sessionId: session._id, athleteId }, { session: mongoSession });
        if (!attendance) return { status: 403, body: { error: "This athlete is not part of the session roster." } };
        await db.collection("attendance").updateOne(
          { _id: attendance._id, organizationId },
          { $set: { status: parsed.data.status, recordedBy: actorId, updatedAt: new Date() } },
          { session: mongoSession },
        );
        return { status: 200, body: { ok: true, status: parsed.data.status } };
      });
      return privateJson(response.body, response.status);
    } catch {
      return privateJson({ error: "Unable to update this session." }, 503);
    }
  };
}
