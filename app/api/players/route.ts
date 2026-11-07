import bcrypt from "bcryptjs";
import { ObjectId } from "mongodb";
import { authorize } from "@/lib/auth";
import { getDb, withDbTransaction } from "@/lib/db";
import { privateJson, readJson, sameOriginFailure } from "@/lib/http";
import { canManageTeam, getAccessibleTeamIds, teamScope } from "@/lib/team-access";
import type { AthleteDocument, TeamDocument, UserDocument } from "@/lib/types";
import { athleteSchema } from "@/lib/validation";

export const runtime = "nodejs";

export async function GET() {
  const access = await authorize(["admin", "coach", "player"]);
  if (!access.user) return privateJson({ error: access.error }, access.status);
  try {
    const db = await getDb();
    const organizationId = new ObjectId(access.user.organizationId);
    const teamIds = await getAccessibleTeamIds(db, access.user);
    const query = access.user.role === "player"
      ? access.user.athleteId
        ? { organizationId, _id: new ObjectId(access.user.athleteId) }
        : { organizationId, _id: { $exists: false } }
      : { organizationId, active: true, ...teamScope(teamIds) };
    const athletes = await db.collection<AthleteDocument>("athletes").find(query).sort({ name: 1 }).toArray();
    return privateJson({ athletes: athletes.map(serializeAthlete) });
  } catch {
    return privateJson({ error: "Unable to load athletes." }, 503);
  }
}

export async function POST(request: Request) {
  const originFailure = sameOriginFailure(request);
  if (originFailure) return originFailure;
  const access = await authorize(["admin", "coach"]);
  if (!access.user) return privateJson({ error: access.error }, access.status);
  const parsed = await readJson(request);
  if (!parsed.ok) return privateJson({ error: parsed.error }, parsed.status);
  const validation = athleteSchema.safeParse(parsed.body);
  if (!validation.success) return privateJson({ error: "Check the athlete details and try again." }, 400);
  const { name, age, studentId, sport, teamId, year, joinedAt, email, password } = validation.data;
  if ((email && !password) || (!email && password)) return privateJson({ error: "Enter both a login email and a temporary password, or leave both empty." }, 400);

  try {
    const db = await getDb();
    const organizationId = new ObjectId(access.user.organizationId);

    const normalizedEmail = email?.toLowerCase();
    const passwordHash = email && password ? await bcrypt.hash(password, 12) : undefined;
    const athleteId = await withDbTransaction(async (transactionDb, session) => {
      const team = await transactionDb.collection<TeamDocument>("teams").findOne({ _id: new ObjectId(teamId), organizationId }, { session });
      if (!team || team.sport !== sport) throw Object.assign(new Error("Choose a team that belongs to this sport and institution."), { status: 400 });
      if (!canManageTeam(access.user!, team)) throw Object.assign(new Error("You are not assigned to this team."), { status: 403 });
      if (await transactionDb.collection<AthleteDocument>("athletes").findOne({ organizationId, studentId }, { session })) {
        throw Object.assign(new Error("That student ID is already on this institution’s roster."), { status: 409 });
      }
      if (normalizedEmail && await transactionDb.collection<UserDocument>("users").findOne({ email: normalizedEmail }, { session })) {
        throw Object.assign(new Error("An account already uses that email."), { status: 409 });
      }
      let userId: ObjectId | undefined;
      if (normalizedEmail && passwordHash) {
        const userResult = await transactionDb.collection("users").insertOne({
          organizationId, name, email: normalizedEmail, passwordHash,
          role: "player", active: true, createdAt: new Date(),
        }, { session });
        userId = userResult.insertedId;
      }
      const athleteResult = await transactionDb.collection("athletes").insertOne({
        organizationId, teamId: team._id, userId, name, age, studentId, sport,
        teamName: team.name, year, joinedAt, active: true, createdAt: new Date(),
      }, { session });
      if (userId) await transactionDb.collection("users").updateOne({ _id: userId, organizationId }, { $set: { athleteId: athleteResult.insertedId } }, { session });
      await transactionDb.collection("auditEvents").insertOne({ organizationId, actorId: new ObjectId(access.user!.id), action: "athlete.created", entity: "athlete", entityId: athleteResult.insertedId, createdAt: new Date() }, { session });
      return athleteResult.insertedId;
    });
    const athlete = await db.collection<AthleteDocument>("athletes").findOne({ _id: athleteId, organizationId });
    return privateJson({ athlete: athlete ? serializeAthlete(athlete) : null }, 201);
  } catch (error) {
    if (error && typeof error === "object" && "status" in error) {
      const status = typeof error.status === "number" ? error.status : 400;
      return privateJson({ error: error instanceof Error ? error.message : "The athlete could not be created." }, status);
    }
    if (error && typeof error === "object" && "code" in error && error.code === 11000) return privateJson({ error: "That student ID or email is already in use." }, 409);
    return privateJson({ error: "Unable to add this athlete." }, 503);
  }
}

function serializeAthlete(athlete: AthleteDocument) {
  return {
    id: String(athlete._id),
    name: athlete.name,
    age: athlete.age,
    studentId: athlete.studentId,
    sport: athlete.sport,
    teamId: String(athlete.teamId),
    team: athlete.teamName,
    year: athlete.year,
    joinedAt: athlete.joinedAt,
    active: athlete.active,
  };
}
