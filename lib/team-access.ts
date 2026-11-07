import { ObjectId, type Db } from "mongodb";
import type { AuthUser, TeamDocument } from "@/lib/types";

export async function getAccessibleTeamIds(db: Db, user: AuthUser): Promise<ObjectId[] | null> {
  const organizationId = new ObjectId(user.organizationId);
  if (user.role === "admin") return null;
  if (user.role === "coach") {
    const teams = await db.collection<TeamDocument>("teams")
      .find({ organizationId, coachIds: new ObjectId(user.id) }, { projection: { _id: 1 } })
      .toArray();
    return teams.map((team) => team._id);
  }
  if (user.role === "player" && user.athleteId) {
    const athlete = await db.collection("athletes").findOne({
      _id: new ObjectId(user.athleteId), organizationId, active: true,
    }, { projection: { teamId: 1 } });
    return athlete?.teamId instanceof ObjectId ? [athlete.teamId] : [];
  }
  return [];
}

export function teamScope(teamIds: ObjectId[] | null) {
  return teamIds === null ? {} : { teamId: { $in: teamIds } };
}

export function canManageTeam(user: AuthUser, team: TeamDocument) {
  return user.role === "admin" || (user.role === "coach" && (team.coachIds ?? []).some((id) => String(id) === user.id));
}
