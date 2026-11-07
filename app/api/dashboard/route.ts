import { ObjectId } from "mongodb";
import { authorize } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { attendanceRate, isTrialReady } from "@/lib/domain";
import { privateJson } from "@/lib/http";
import { getAccessibleTeamIds, teamScope } from "@/lib/team-access";
import type { AthleteDocument, MatchDocument, SessionDocument, TeamDocument } from "@/lib/types";

export const runtime = "nodejs";
const PAGE_SIZE = 100;

function currentWeekRange() {
  const parts = new Intl.DateTimeFormat("en", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "00";
  const today = `${part("year")}-${part("month")}-${part("day")}`;
  const monday = new Date(`${today}T00:00:00.000Z`);
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
  return { start: monday.toISOString().slice(0, 10), end: today };
}

export async function GET() {
  const access = await authorize();
  if (!access.user) return privateJson({ error: access.error }, access.status);
  try {
    const db = await getDb();
    const organizationId = new ObjectId(access.user.organizationId);
    const teamIds = await getAccessibleTeamIds(db, access.user);
    const scope = teamIds === null || access.user.role === "scout" ? {} : teamScope(teamIds);
    const [organization, allTeams] = await Promise.all([
      db.collection("organizations").findOne({ _id: organizationId }),
      db.collection<TeamDocument>("teams").find({ organizationId }).sort({ sport: 1, name: 1 }).toArray(),
    ]);
    const teams = teamIds === null || access.user.role === "scout"
      ? allTeams
      : allTeams.filter((team) => teamIds.some((id) => String(id) === String(team._id)));

    const athleteQuery: Record<string, unknown> = { organizationId, active: true, ...scope };
    if (access.user.role === "player") {
      if (!access.user.athleteId) athleteQuery._id = { $exists: false };
      else athleteQuery._id = new ObjectId(access.user.athleteId);
    }
    const allAthletes = await db.collection<AthleteDocument>("athletes").find(athleteQuery).sort({ name: 1 }).toArray();
    const { start: weekStart, end: weekEnd } = currentWeekRange();
    const sessionQuery = { organizationId, ...scope };
    const [recentSessions, recentMatches, sessionsThisWeek, openSessions, attendanceStats, scoreStats] = await Promise.all([
      access.user.role === "scout"
        ? Promise.resolve([] as SessionDocument[])
        : db.collection<SessionDocument>("sessions").find(sessionQuery).sort({ date: -1, startTime: -1, _id: -1 }).limit(PAGE_SIZE).toArray(),
      access.user.role === "scout"
        ? Promise.resolve([] as MatchDocument[])
        : db.collection<MatchDocument>("matches").find({ organizationId, ...scope }).sort({ date: -1, startTime: -1, _id: -1 }).limit(PAGE_SIZE).toArray(),
      access.user.role === "scout" ? Promise.resolve(0) : db.collection("sessions").countDocuments({ ...sessionQuery, date: { $gte: weekStart, $lte: weekEnd } }),
      access.user.role === "admin" || access.user.role === "coach"
        ? db.collection("sessions").countDocuments({ ...sessionQuery, status: "open" })
        : Promise.resolve(0),
      db.collection("attendance").aggregate<{ _id: ObjectId; present: number; total: number }>([
        { $match: { organizationId } },
        { $lookup: { from: "sessions", localField: "sessionId", foreignField: "_id", as: "sessionDoc" } },
        { $unwind: "$sessionDoc" },
        { $match: { "sessionDoc.organizationId": organizationId, "sessionDoc.status": "closed" } },
        { $group: { _id: "$athleteId", present: { $sum: { $cond: [{ $eq: ["$status", "present"] }, 1, 0] } }, total: { $sum: 1 } } },
      ]).toArray(),
      db.collection("matchScores").aggregate<{ _id: ObjectId; matches: number }>([
        { $match: { organizationId } },
        { $lookup: { from: "matches", localField: "matchId", foreignField: "_id", as: "matchDoc" } },
        { $unwind: "$matchDoc" },
        { $match: { "matchDoc.organizationId": organizationId } },
        { $group: { _id: "$athleteId", matches: { $sum: 1 } } },
      ]).toArray(),
    ]);

    const attendanceByAthlete = new Map(attendanceStats.map((row) => [String(row._id), { present: row.present, total: row.total }]));
    const matchesByAthlete = new Map(scoreStats.map((row) => [String(row._id), row.matches]));
    const athleteStats = (athlete: AthleteDocument) => {
      const attendance = attendanceByAthlete.get(String(athlete._id)) ?? { present: 0, total: 0 };
      const matchesPlayed = matchesByAthlete.get(String(athlete._id)) ?? 0;
      return {
        attendancePercent: attendanceRate(attendance.present, attendance.total),
        presentSessions: attendance.present,
        closedSessions: attendance.total,
        matchesPlayed,
        ready: isTrialReady(attendance.present, attendance.total, matchesPlayed),
      };
    };
    const serializeAthlete = (athlete: AthleteDocument, includeStudentId: boolean) => ({
      id: String(athlete._id),
      name: athlete.name,
      age: athlete.age,
      ...(includeStudentId ? { studentId: athlete.studentId } : {}),
      sport: athlete.sport,
      teamId: String(athlete.teamId),
      team: athlete.teamName,
      year: athlete.year,
      ...athleteStats(athlete),
    });

    const athletesWithStats = allAthletes.map((athlete) => ({ athlete, stats: athleteStats(athlete) }));
    const readyAthleteIds = new Set(athletesWithStats.filter(({ stats }) => stats.ready).map(({ athlete }) => String(athlete._id)));
    const visibleAthletes = access.user.role === "scout"
      ? athletesWithStats.filter(({ stats }) => stats.ready).map(({ athlete }) => serializeAthlete(athlete, false))
      : athletesWithStats.map(({ athlete }) => serializeAthlete(athlete, true));
    const visibleTeams = access.user.role === "scout"
      ? teams.filter((team) => athletesWithStats.some(({ athlete }) => String(athlete.teamId) === String(team._id) && readyAthleteIds.has(String(athlete._id))))
      : teams;
    const metricAthletes = access.user.role === "scout"
      ? allAthletes.filter((athlete) => readyAthleteIds.has(String(athlete._id)))
      : allAthletes;

    const attendanceRowsForVisible = recentSessions.length
      ? await db.collection("attendance").find({ organizationId, sessionId: { $in: recentSessions.map((session) => session._id) } }).toArray()
      : [];
    const athleteById = new Map(allAthletes.map((athlete) => [String(athlete._id), athlete]));
    const attendanceBySession = new Map<string, typeof attendanceRowsForVisible>();
    for (const row of attendanceRowsForVisible) attendanceBySession.set(String(row.sessionId), [...(attendanceBySession.get(String(row.sessionId)) ?? []), row]);
    const sessionPayload = recentSessions.map((session) => ({
      id: String(session._id), title: session.title, teamId: String(session.teamId), team: session.teamName,
      sport: session.sport, date: session.date, time: session.startTime, status: session.status,
      attendance: (attendanceBySession.get(String(session._id)) ?? []).flatMap((row) => {
        const athlete = athleteById.get(String(row.athleteId));
        if (!athlete || (access.user?.role === "player" && String(athlete._id) !== access.user.athleteId)) return [];
        return [{ athleteId: String(athlete._id), name: athlete.name, studentId: access.user?.role === "player" ? undefined : athlete.studentId, status: row.status }];
      }),
    }));

    const visibleMatchIds = recentMatches.map((match) => match._id);
    const visibleScoreRows = visibleMatchIds.length
      ? await db.collection("matchScores").find({ organizationId, matchId: { $in: visibleMatchIds } }).toArray()
      : [];
    const matchPayload = recentMatches.map((match) => ({
      id: String(match._id), sessionId: String(match.sessionId), teamId: String(match.teamId),
      team: match.teamName, sport: match.sport, opponent: match.opponent, date: match.date, time: match.startTime,
      scores: visibleScoreRows.filter((row) => String(row.matchId) === String(match._id)).flatMap((row) => {
        const athlete = athleteById.get(String(row.athleteId));
        if (!athlete || (access.user?.role === "player" && String(athlete._id) !== access.user.athleteId)) return [];
        return [{ athleteId: String(athlete._id), name: athlete.name, score: row.score }];
      }),
    }));

    const readyCount = metricAthletes.filter((athlete) => athleteStats(athlete).ready).length;
    return privateJson({
      user: access.user,
      organization: organization ? { name: organization.name, type: organization.type, city: organization.city, timezone: organization.timezone } : null,
      teams: visibleTeams.map((team) => ({ id: String(team._id), name: team.name, sport: team.sport, season: team.season, coachIds: access.user?.role === "admin" ? (team.coachIds ?? []).map(String) : undefined, athleteCount: metricAthletes.filter((athlete) => String(athlete.teamId) === String(team._id)).length })),
      athletes: visibleAthletes,
      sessions: sessionPayload,
      matches: matchPayload,
      metrics: {
        activeAthletes: metricAthletes.length,
        attendanceRate: metricAthletes.length ? Math.round(metricAthletes.reduce((sum, athlete) => sum + athleteStats(athlete).attendancePercent, 0) / metricAthletes.length) : 0,
        sessionsThisWeek,
        openSessions,
        readyCount,
      },
      teamLookup: access.user.role === "admin" || access.user.role === "coach" ? visibleTeams.map((team) => ({ id: String(team._id), name: team.name, sport: team.sport })) : [],
    });
  } catch {
    return privateJson({ error: "Unable to load the institution workspace." }, 503);
  }
}
