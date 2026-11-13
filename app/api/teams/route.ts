import { ObjectId } from "mongodb";
import { z } from "zod";
import { authorize } from "@/lib/auth";
import { getDb, withDbTransaction } from "@/lib/db";
import { privateJson, readJson, sameOriginFailure } from "@/lib/http";
import { getAccessibleTeamIds, teamScope } from "@/lib/team-access";
import type { TeamDocument } from "@/lib/types";

export const runtime = "nodejs";

const teamSchema = z.object({
  name: z.string().trim().min(2).max(80),
  sport: z.string().trim().min(2).max(50),
});

export async function GET() {
  const access = await authorize(["admin", "coach", "player"]);
  if (!access.user) return privateJson({ error: access.error }, access.status);
  try {
    const db = await getDb();
    const organizationId = new ObjectId(access.user.organizationId);
    const teamIds = await getAccessibleTeamIds(db, access.user);
    const query = { organizationId, ...teamScope(teamIds) };
    const teams = await db.collection<TeamDocument>("teams").find(query).sort({ sport: 1, name: 1 }).toArray();
    return privateJson({ teams: teams.map((team) => ({ id: String(team._id), name: team.name, sport: team.sport, coachIds: access.user?.role === "admin" || access.user?.role === "coach" ? (team.coachIds ?? []).map(String) : undefined })) });
  } catch {
    return privateJson({ error: "Unable to load teams." }, 503);
  }
}

export async function POST(request: Request) {
  const originFailure = sameOriginFailure(request);
  if (originFailure) return originFailure;
  const access = await authorize(["admin", "coach"]);
  if (!access.user) return privateJson({ error: access.error }, access.status);
  const parsed = await readJson(request);
  if (!parsed.ok) return privateJson({ error: parsed.error }, parsed.status);
  const validation = teamSchema.safeParse(parsed.body);
  if (!validation.success) return privateJson({ error: "Add a team name and sport." }, 400);
  const { name, sport } = validation.data;
  try {
    const organizationId = new ObjectId(access.user.organizationId);
    const team = await withDbTransaction(async (transactionDb, session) => {
      const existing = await transactionDb.collection<TeamDocument>("teams").findOne({ organizationId, name, sport }, { session });
      if (existing) throw Object.assign(new Error("That team already exists for this sport."), { status: 409 });
      const coachIds = access.user!.role === "coach" ? [new ObjectId(access.user!.id)] : [];
      const result = await transactionDb.collection("teams").insertOne({ organizationId, name, sport, coachIds, createdAt: new Date() }, { session });
      return result.insertedId;
    });
    return privateJson({ team: { id: String(team), name, sport } }, 201);
  } catch (error) {
    if (error && typeof error === "object" && "status" in error && error.status === 409) return privateJson({ error: "That team already exists for this sport." }, 409);
    if (error && typeof error === "object" && "code" in error && error.code === 11000) return privateJson({ error: "That team already exists for this sport." }, 409);
    return privateJson({ error: "Unable to create the team." }, 503);
  }
}
