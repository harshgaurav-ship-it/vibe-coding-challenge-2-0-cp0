import { ObjectId } from "mongodb";
import { authorize } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { privateJson } from "@/lib/http";
import { getAccessibleTeamIds, teamScope } from "@/lib/team-access";
import type { MatchDocument } from "@/lib/types";
import { createMatchHandler } from "@/lib/route-handlers/create-match";

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

export const POST = createMatchHandler();
