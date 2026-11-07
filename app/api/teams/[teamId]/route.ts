import { ObjectId } from "mongodb";
import { z } from "zod";
import { authorize } from "@/lib/auth";
import { withDbTransaction } from "@/lib/db";
import { privateJson, readJson, sameOriginFailure } from "@/lib/http";
import type { TeamDocument } from "@/lib/types";

export const runtime = "nodejs";

const assignmentSchema = z.object({
  coachIds: z.array(z.string().regex(/^[a-f\d]{24}$/i)).max(50),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ teamId: string }> }) {
  const originFailure = sameOriginFailure(request);
  if (originFailure) return originFailure;
  const access = await authorize(["admin"]);
  if (!access.user) return privateJson({ error: access.error }, access.status);
  const { teamId } = await params;
  if (!ObjectId.isValid(teamId)) return privateJson({ error: "Team not found." }, 404);
  const body = await readJson(request);
  if (!body.ok) return privateJson({ error: body.error }, body.status);
  const parsed = assignmentSchema.safeParse(body.body);
  if (!parsed.success || new Set(parsed.data.coachIds).size !== parsed.data.coachIds.length) {
    return privateJson({ error: "Choose valid coaches without duplicates." }, 400);
  }

  try {
    const organizationId = new ObjectId(access.user.organizationId);
    const teamObjectId = new ObjectId(teamId);
    const coachIds = parsed.data.coachIds.map((id) => new ObjectId(id));
    const team = await withDbTransaction(async (db, session) => {
      const existing = await db.collection<TeamDocument>("teams").findOne({ _id: teamObjectId, organizationId }, { session });
      if (!existing) throw Object.assign(new Error("Team not found."), { status: 404 });
      const coaches = await db.collection("users").find({ organizationId, _id: { $in: coachIds }, role: "coach", active: true }, { projection: { _id: 1 }, session }).toArray();
      if (coaches.length !== coachIds.length) throw Object.assign(new Error("One or more selected accounts are not active coaches in this institution."), { status: 400 });
      await db.collection("teams").updateOne({ _id: teamObjectId, organizationId }, { $set: { coachIds } }, { session });
      await db.collection("auditEvents").insertOne({ organizationId, actorId: new ObjectId(access.user!.id), action: "team.coaches_updated", entity: "team", entityId: teamObjectId, details: { coachIds }, createdAt: new Date() }, { session });
      return { id: String(teamObjectId), coachIds: coachIds.map(String) };
    });
    return privateJson({ team });
  } catch (error) {
    if (error && typeof error === "object" && "status" in error) {
      const status = error.status === 404 ? 404 : 400;
      return privateJson({ error: error instanceof Error ? error.message : "The team assignment could not be updated." }, status);
    }
    return privateJson({ error: "Unable to update team assignments." }, 503);
  }
}
