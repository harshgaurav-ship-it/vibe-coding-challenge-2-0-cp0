import assert from "node:assert/strict";
import test from "node:test";
import { ObjectId, type ClientSession, type Db } from "mongodb";
import type { AuthUser, AthleteDocument, MatchDocument, SessionDocument, TeamDocument } from "@/lib/types";
import { createMatchHandler } from "@/lib/route-handlers/create-match";
import { createDashboardHandler } from "@/lib/route-handlers/dashboard";
import { createOpenSessionHandler } from "@/lib/route-handlers/open-session";
import { createSaveScoreHandler } from "@/lib/route-handlers/save-score";
import { createSessionUpdateHandler } from "@/lib/route-handlers/session-update";
import type { authorize } from "@/lib/auth";
import type { withDbTransaction } from "@/lib/db";

const ids = {
  coach: "000000000000000000000001",
  player: "000000000000000000000002",
  otherPlayer: "000000000000000000000003",
  scout: "000000000000000000000004",
  organization: "000000000000000000000005",
  team: "000000000000000000000006",
  session: "000000000000000000000007",
  match: "000000000000000000000008",
};

const coach: AuthUser = {
  id: ids.coach,
  organizationId: ids.organization,
  name: "Coach",
  email: "coach@academy.test",
  role: "coach",
};

function authorizeAs(user: AuthUser): typeof authorize {
  return async () => ({ user, status: 200, error: "" });
}

function makeDb(collections: Record<string, Record<string, unknown>>) {
  return {
    collection: (name: string) => collections[name],
  } as unknown as Db;
}

function cursor<T>(rows: T[]) {
  const result = {
    sort: () => result,
    limit: () => result,
    project: () => result,
    toArray: async () => rows,
  };
  return result;
}

function transactionFor(db: Db): typeof withDbTransaction {
  return async <T>(operation: (database: Db, session: ClientSession) => Promise<T>) => operation(db, {} as ClientSession);
}

function jsonRequest(path: string, method: string, body: Record<string, unknown>) {
  return new Request(`http://localhost${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function teamRecord(): TeamDocument {
  return {
    _id: new ObjectId(ids.team),
    organizationId: new ObjectId(ids.organization),
    name: "First team",
    sport: "Football",
    coachIds: [new ObjectId(ids.coach)],
    createdAt: new Date("2026-11-01T00:00:00Z"),
  };
}

test("opening a session creates an Absent row for every team athlete", async () => {
  const team = teamRecord();
  const athletes = [ids.player, ids.otherPlayer].map((id, index) => ({
    _id: new ObjectId(id),
    organizationId: new ObjectId(ids.organization),
    teamId: team._id,
    name: `Player ${index + 1}`,
    sport: "Football",
    active: true,
  } as AthleteDocument));
  let attendanceRows: Record<string, unknown>[] = [];
  const database = makeDb({
    teams: { findOne: async () => team },
    athletes: { find: () => cursor(athletes) },
    sessions: {
      findOne: async () => null,
      insertOne: async () => ({ insertedId: new ObjectId(ids.session) }),
    },
    attendance: { insertMany: async (rows: Record<string, unknown>[]) => { attendanceRows = rows; } },
  });
  const post = createOpenSessionHandler({ authorize: authorizeAs(coach), withDbTransaction: transactionFor(database) });

  const response = await post(jsonRequest("/api/sessions", "POST", {
    teamId: ids.team,
    title: "Practice",
    date: "2026-11-12",
    startTime: "15:30",
  }));
  const body = await response.json() as { session: { status: string; attendanceCount: number } };

  assert.equal(response.status, 201);
  assert.equal(body.session.status, "open");
  assert.equal(body.session.attendanceCount, 2);
  assert.equal(attendanceRows.length, 2);
  assert.deepEqual(attendanceRows.map((row) => row.status), ["absent", "absent"]);
});

test("attendance can change while open, then session closure locks it", async () => {
  const team = teamRecord();
  const session: SessionDocument = {
    _id: new ObjectId(ids.session),
    organizationId: new ObjectId(ids.organization),
    teamId: team._id,
    teamName: team.name,
    sport: team.sport,
    title: "Practice",
    date: "2026-11-12",
    startTime: "15:30",
    status: "open",
    createdBy: new ObjectId(ids.coach),
    createdAt: new Date("2026-11-12T09:00:00Z"),
  };
  const attendance = { _id: new ObjectId(ids.otherPlayer), status: "absent" };
  let attendanceWrites = 0;
  const database = makeDb({
    sessions: {
      findOne: async () => ({ ...session }),
      updateOne: async (_query: unknown, update: { $set: Partial<SessionDocument> }) => {
        Object.assign(session, update.$set);
        return { modifiedCount: 1 };
      },
    },
    teams: { findOne: async () => team },
    attendance: {
      findOne: async () => attendance,
      updateOne: async (_query: unknown, update: { $set: { status: string } }) => {
        attendance.status = update.$set.status;
        attendanceWrites += 1;
        return { modifiedCount: 1 };
      },
    },
  });
  const patch = createSessionUpdateHandler({ authorize: authorizeAs(coach), withDbTransaction: transactionFor(database) });
  const context = { params: Promise.resolve({ sessionId: ids.session }) };

  const markResponse = await patch(jsonRequest(`/api/sessions/${ids.session}`, "PATCH", {
    action: "mark", athleteId: ids.otherPlayer, status: "present",
  }), context);
  assert.equal(markResponse.status, 200);
  assert.equal(attendance.status, "present");

  const closeResponse = await patch(jsonRequest(`/api/sessions/${ids.session}`, "PATCH", { action: "close" }), context);
  assert.equal(closeResponse.status, 200);
  assert.equal(session.status, "closed");

  const lockedResponse = await patch(jsonRequest(`/api/sessions/${ids.session}`, "PATCH", {
    action: "mark", athleteId: ids.otherPlayer, status: "absent",
  }), context);
  assert.equal(lockedResponse.status, 409);
  assert.equal(attendanceWrites, 1);
});

test("match date and sport are entered and must match a closed register", async () => {
  const team = teamRecord();
  const attendanceSession = {
    _id: new ObjectId(ids.session),
    organizationId: new ObjectId(ids.organization),
    teamId: team._id,
    date: "2026-11-12",
    sport: "Football",
    status: "closed",
  };
  let insertedMatch: Record<string, unknown> | undefined;
  const database = makeDb({
    sessions: { findOne: async () => attendanceSession },
    teams: { findOne: async () => team },
    matches: {
      findOne: async () => null,
      insertOne: async (record: Record<string, unknown>) => {
        insertedMatch = record;
        return { insertedId: new ObjectId(ids.match) };
      },
    },
  });
  const post = createMatchHandler({ authorize: authorizeAs(coach), withDbTransaction: transactionFor(database) });
  const body = { sessionId: ids.session, date: "2026-11-12", sport: "Football", opponent: "Rivals", startTime: "16:00" };

  const mismatch = await post(jsonRequest("/api/matches", "POST", { ...body, date: "2026-11-13" }));
  assert.equal(mismatch.status, 409);
  assert.equal(insertedMatch, undefined);

  const accepted = await post(jsonRequest("/api/matches", "POST", body));
  assert.equal(accepted.status, 201);
  const createdMatch = insertedMatch as Record<string, unknown> | undefined;
  assert.equal(createdMatch?.date, body.date);
  assert.equal(createdMatch?.sport, body.sport);
});

test("only a present athlete in the match's closed register can receive a score", async () => {
  const team = teamRecord();
  const match = {
    _id: new ObjectId(ids.match),
    organizationId: new ObjectId(ids.organization),
    teamId: team._id,
    sessionId: new ObjectId(ids.session),
  };
  const attendanceSession = { _id: match.sessionId, teamId: team._id, status: "closed" };
  let attendanceStatus = "absent";
  let savedScore: Record<string, unknown> | undefined;
  const database = makeDb({
    matches: { findOne: async () => match },
    teams: { findOne: async () => team },
    sessions: { findOne: async () => attendanceSession },
    attendance: { findOne: async () => ({ status: attendanceStatus }) },
    matchScores: { updateOne: async (_query: unknown, update: { $set: Record<string, unknown> }) => { savedScore = update.$set; } },
  });
  const post = createSaveScoreHandler({ authorize: authorizeAs(coach), withDbTransaction: transactionFor(database) });
  const context = { params: Promise.resolve({ matchId: ids.match }) };
  const body = { athleteId: ids.player, score: 8.5 };

  const absentResponse = await post(jsonRequest(`/api/matches/${ids.match}/scores`, "POST", body), context);
  assert.equal(absentResponse.status, 403);
  assert.equal(savedScore, undefined);

  attendanceStatus = "present";
  const presentResponse = await post(jsonRequest(`/api/matches/${ids.match}/scores`, "POST", body), context);
  assert.equal(presentResponse.status, 200);
  const updatedScore = savedScore as Record<string, unknown> | undefined;
  assert.equal(updatedScore?.score, 8.5);
});

test("scouts receive only players who meet both readiness rules", async () => {
  const scout: AuthUser = {
    id: ids.scout,
    organizationId: ids.organization,
    name: "Scout",
    email: "scout@academy.test",
    role: "scout",
  };
  const team = teamRecord();
  const athletes = [ids.player, ids.otherPlayer].map((id, index) => ({
    _id: new ObjectId(id),
    organizationId: new ObjectId(ids.organization),
    teamId: team._id,
    name: `Player ${index + 1}`,
    age: 17,
    studentId: `S${index + 1}`,
    sport: "Football",
    teamName: team.name,
    year: "Year 12",
    active: true,
  } as AthleteDocument));
  const database = makeDb({
    organizations: { findOne: async () => ({ name: "Dumka Academy", type: "academy", timezone: "Asia/Kolkata" }) },
    teams: { find: () => cursor([team]) },
    athletes: { find: () => cursor(athletes) },
    attendance: {
      aggregate: () => ({ toArray: async () => [
        { _id: new ObjectId(ids.player), present: 3, total: 4 },
        { _id: new ObjectId(ids.otherPlayer), present: 3, total: 4 },
      ] }),
    },
    matchScores: {
      aggregate: () => ({ toArray: async () => [
        { _id: new ObjectId(ids.player), matches: 2 },
        { _id: new ObjectId(ids.otherPlayer), matches: 1 },
      ] }),
    },
  });
  const get = createDashboardHandler({
    authorize: authorizeAs(scout),
    getDb: async () => database,
    getAccessibleTeamIds: async () => null,
  });

  const response = await get();
  const body = await response.json() as { athletes: { id: string; studentId?: string }[]; metrics: { readyCount: number } };

  assert.equal(response.status, 200);
  assert.deepEqual(body.athletes.map((athlete) => athlete.id), [ids.player]);
  assert.equal(body.athletes[0]?.studentId, undefined);
  assert.equal(body.metrics.readyCount, 1);
});

test("players receive only their own attendance and match rows", async () => {
  const player: AuthUser = {
    id: ids.player,
    organizationId: ids.organization,
    name: "Player 1",
    email: "player@academy.test",
    role: "player",
    athleteId: ids.player,
  };
  const team = teamRecord();
  const athlete = {
    _id: new ObjectId(ids.player),
    organizationId: new ObjectId(ids.organization),
    teamId: team._id,
    name: "Player 1",
    age: 17,
    studentId: "S1",
    sport: "Football",
    teamName: team.name,
    year: "Year 12",
    active: true,
  } as AthleteDocument;
  const session = {
    _id: new ObjectId(ids.session),
    organizationId: new ObjectId(ids.organization),
    teamId: team._id,
    teamName: team.name,
    sport: "Football",
    title: "Practice",
    date: "2026-11-12",
    startTime: "15:30",
    status: "closed",
  } as SessionDocument;
  const match = {
    _id: new ObjectId(ids.match),
    organizationId: new ObjectId(ids.organization),
    teamId: team._id,
    teamName: team.name,
    sessionId: session._id,
    sport: "Football",
    opponent: "Rivals",
    date: "2026-11-12",
    startTime: "16:00",
  } as unknown as MatchDocument;
  const otherAttendance = { _id: new ObjectId(), sessionId: session._id, athleteId: new ObjectId(ids.otherPlayer), status: "present" };
  const ownAttendance = { _id: new ObjectId(), sessionId: session._id, athleteId: athlete._id, status: "present" };
  const database = makeDb({
    organizations: { findOne: async () => ({ name: "Dumka Academy", type: "academy", timezone: "Asia/Kolkata" }) },
    teams: { find: () => cursor([team]) },
    athletes: { find: () => cursor([athlete]) },
    sessions: {
      find: () => cursor([session]),
      countDocuments: async () => 1,
    },
    matches: { find: () => cursor([match]) },
    attendance: {
      aggregate: () => ({ toArray: async () => [{ _id: athlete._id, present: 3, total: 4 }] }),
      find: () => cursor([ownAttendance, otherAttendance]),
    },
    matchScores: {
      aggregate: () => ({ toArray: async () => [{ _id: athlete._id, matches: 2 }] }),
      find: () => cursor([
        { matchId: match._id, athleteId: athlete._id, score: 8 },
        { matchId: match._id, athleteId: new ObjectId(ids.otherPlayer), score: 9 },
      ]),
    },
  });
  const get = createDashboardHandler({
    authorize: authorizeAs(player),
    getDb: async () => database,
    getAccessibleTeamIds: async () => [team._id],
  });

  const response = await get();
  const body = await response.json() as {
    athletes: { id: string; studentId?: string }[];
    sessions: { attendance: { athleteId: string; studentId?: string }[] }[];
    matches: { scores: { athleteId: string; score: number }[] }[];
  };

  assert.equal(response.status, 200);
  assert.deepEqual(body.athletes.map((item) => item.id), [ids.player]);
  assert.equal(body.athletes[0]?.studentId, "S1");
  assert.deepEqual(body.sessions[0]?.attendance.map((row) => row.athleteId), [ids.player]);
  assert.deepEqual(body.matches[0]?.scores.map((row) => row.athleteId), [ids.player]);
});
