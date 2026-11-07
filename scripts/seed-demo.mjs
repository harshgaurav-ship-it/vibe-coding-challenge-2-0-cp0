import bcrypt from "bcryptjs";
import { MongoClient, ObjectId } from "mongodb";

const uri = process.env.MONGODB_URI;
const databaseName = process.env.MONGODB_DB || "";
const required = ["DEMO_ADMIN_EMAIL", "DEMO_ADMIN_PASSWORD", "DEMO_COACH_EMAIL", "DEMO_COACH_PASSWORD", "DEMO_SCOUT_EMAIL", "DEMO_SCOUT_PASSWORD", "DEMO_PLAYER_EMAIL", "DEMO_PLAYER_PASSWORD"];

if (process.env.NODE_ENV === "production") throw new Error("The demo seed is disabled in production.");
if (process.env.FIELDHOUSE_SEED_DEMO !== "true") throw new Error("Set FIELDHOUSE_SEED_DEMO=true to explicitly enable demo seeding.");
if (!databaseName.toLowerCase().includes("demo")) throw new Error("MONGODB_DB must include 'demo'. Use a separate demo database.");
if (!uri) throw new Error("MONGODB_URI is required.");
for (const name of required) if (!process.env[name]) throw new Error(`${name} is required. Set a private value in .env.local.`);

const client = new MongoClient(uri, { maxPoolSize: 5 });

function dateDaysAgo(days) {
  const date = new Date(Date.now() - days * 86_400_000);
  const parts = new Intl.DateTimeFormat("en", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const part = (type) => parts.find((item) => item.type === type)?.value ?? "00";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

async function upsertDoc(collection, filter, document) {
  await collection.updateOne(filter, { $set: document }, { upsert: true });
  return collection.findOne(filter);
}

try {
  await client.connect();
  const db = client.db(databaseName);
  const orgs = db.collection("organizations");
  const users = db.collection("users");
  const teams = db.collection("teams");
  const athletes = db.collection("athletes");
  const sessions = db.collection("sessions");
  const attendance = db.collection("attendance");
  const matches = db.collection("matches");
  const scores = db.collection("matchScores");

  await Promise.all([
    orgs.createIndex({ slug: 1 }, { unique: true }),
    users.createIndex({ email: 1 }, { unique: true }),
    teams.createIndex({ organizationId: 1, name: 1, sport: 1, season: 1 }, { unique: true }),
    athletes.createIndex({ organizationId: 1, studentId: 1 }, { unique: true }),
    sessions.createIndex({ organizationId: 1, teamId: 1, date: 1, startTime: 1, title: 1 }, { unique: true }),
    attendance.createIndex({ organizationId: 1, sessionId: 1, athleteId: 1 }, { unique: true }),
    matches.createIndex({ organizationId: 1, teamId: 1, date: 1, opponent: 1 }, { unique: true }),
    scores.createIndex({ organizationId: 1, matchId: 1, athleteId: 1 }, { unique: true }),
    db.collection("loginAttempts").createIndex({ key: 1 }, { unique: true }),
    db.collection("loginAttempts").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
  ]);

  const organization = await upsertDoc(orgs, { slug: "dumka-sports-academy" }, {
    name: "Dumka Sports Academy",
    slug: "dumka-sports-academy",
    type: "academy",
    city: "Dumka, Jharkhand",
    timezone: "Asia/Kolkata",
    createdAt: new Date(),
  });
  const organizationId = organization._id;
  const season = "Monsoon 2026";
  const teamInputs = [
    { name: "U17 Football", sport: "Football" },
    { name: "Senior Basketball", sport: "Basketball" },
    { name: "Athletics Squad", sport: "Athletics" },
  ];
  const teamByName = new Map();
  for (const item of teamInputs) {
    const team = await upsertDoc(teams, { organizationId, name: item.name, sport: item.sport, season }, { organizationId, name: item.name, sport: item.sport, season, coachIds: [], createdAt: new Date() });
    teamByName.set(item.name, team);
  }

  const people = [
    { name: "Aarav Mehta", age: 17, studentId: "DSA-1042", team: "U17 Football", year: "Class 12", joinedAt: dateDaysAgo(30), email: process.env.DEMO_PLAYER_EMAIL.toLowerCase(), password: process.env.DEMO_PLAYER_PASSWORD },
    { name: "Rohan Kumar", age: 16, studentId: "DSA-1095", team: "U17 Football", year: "Class 11" },
    { name: "Kabir Ansari", age: 17, studentId: "DSA-1214", team: "U17 Football", year: "Class 12" },
    { name: "Nisha Sinha", age: 19, studentId: "DSA-1187", team: "Senior Basketball", year: "Year 1" },
    { name: "Dev Patel", age: 20, studentId: "DSA-1151", team: "Senior Basketball", year: "Year 1" },
    { name: "Meera Verma", age: 20, studentId: "DSA-1078", team: "Athletics Squad", year: "Year 2" },
    { name: "Tara Murmu", age: 16, studentId: "DSA-1220", team: "Athletics Squad", year: "Class 10" },
  ];
  const athleteByName = new Map();
  for (const person of people) {
    const team = teamByName.get(person.team);
    const athlete = await upsertDoc(athletes, { organizationId, studentId: person.studentId }, {
      organizationId,
      teamId: team._id,
      teamName: team.name,
      userId: undefined,
      name: person.name,
      age: person.age,
      studentId: person.studentId,
      sport: team.sport,
      year: person.year,
      joinedAt: person.joinedAt ?? dateDaysAgo(30),
      active: true,
      createdAt: new Date(),
    });
    athleteByName.set(person.name, athlete);
  }

  const accountInputs = [
    { name: "Maya Singh", email: process.env.DEMO_ADMIN_EMAIL.toLowerCase(), password: process.env.DEMO_ADMIN_PASSWORD, role: "admin" },
    { name: "Arjun Sinha", email: process.env.DEMO_COACH_EMAIL.toLowerCase(), password: process.env.DEMO_COACH_PASSWORD, role: "coach" },
    { name: "Riya Das", email: process.env.DEMO_SCOUT_EMAIL.toLowerCase(), password: process.env.DEMO_SCOUT_PASSWORD, role: "scout" },
    { name: "Aarav Mehta", email: process.env.DEMO_PLAYER_EMAIL.toLowerCase(), password: process.env.DEMO_PLAYER_PASSWORD, role: "player", athleteId: athleteByName.get("Aarav Mehta")._id },
  ];
  for (const account of accountInputs) {
    const passwordHash = await bcrypt.hash(account.password, 12);
    const user = await upsertDoc(users, { email: account.email }, {
      organizationId,
      name: account.name,
      email: account.email,
      passwordHash,
      role: account.role,
      athleteId: account.athleteId,
      active: true,
      createdAt: new Date(),
    });
    if (account.athleteId) await athletes.updateOne({ _id: account.athleteId, organizationId }, { $set: { userId: user._id } });
  }
  const coach = await users.findOne({ email: process.env.DEMO_COACH_EMAIL.toLowerCase() });
  if (coach) await teams.updateMany({ organizationId }, { $addToSet: { coachIds: coach._id } });

  const football = teamByName.get("U17 Football");
  const footballAthletes = people.filter((person) => person.team === "U17 Football").map((person) => athleteByName.get(person.name));
  const footballAttendance = [
    { "Aarav Mehta": "present", "Rohan Kumar": "present", "Kabir Ansari": "absent" },
    { "Aarav Mehta": "present", "Rohan Kumar": "absent", "Kabir Ansari": "present" },
    { "Aarav Mehta": "present", "Rohan Kumar": "present", "Kabir Ansari": "absent" },
    { "Aarav Mehta": "absent", "Rohan Kumar": "absent", "Kabir Ansari": "absent" },
  ];
  const pastFootballSessions = [];
  for (let index = 0; index < 4; index += 1) {
    const date = dateDaysAgo(10 - index * 2);
    const session = await upsertDoc(sessions, { organizationId, teamId: football._id, date, title: "Skills & conditioning" }, {
      organizationId, teamId: football._id, teamName: football.name, sport: football.sport,
      title: "Skills & conditioning", date, startTime: "15:30", status: "closed",
      createdBy: coach?._id ?? new ObjectId(), closedAt: new Date(), createdAt: new Date(),
    });
    pastFootballSessions.push(session);
    for (const athlete of footballAthletes) {
      const person = people.find((item) => item.studentId === athlete.studentId);
      const status = footballAttendance[index][person.name];
      await attendance.updateOne({ organizationId, sessionId: session._id, athleteId: athlete._id }, { $set: { organizationId, sessionId: session._id, athleteId: athlete._id, status, recordedBy: coach?._id ?? new ObjectId(), updatedAt: new Date() } }, { upsert: true });
    }
  }

  const basketball = teamByName.get("Senior Basketball");
  const basketballAthletes = people.filter((person) => person.team === "Senior Basketball").map((person) => athleteByName.get(person.name));
  const basketballSessions = [];
  for (let index = 0; index < 3; index += 1) {
    const date = dateDaysAgo(9 - index * 3);
    const session = await upsertDoc(sessions, { organizationId, teamId: basketball._id, date, title: "Court fundamentals" }, {
      organizationId, teamId: basketball._id, teamName: basketball.name, sport: basketball.sport,
      title: "Court fundamentals", date, startTime: "16:00", status: "closed",
      createdBy: coach?._id ?? new ObjectId(), closedAt: new Date(), createdAt: new Date(),
    });
    basketballSessions.push(session);
    for (const athlete of basketballAthletes) {
      const status = athlete.name === "Nisha Sinha" || index < 2 ? "present" : "absent";
      await attendance.updateOne({ organizationId, sessionId: session._id, athleteId: athlete._id }, { $set: { organizationId, sessionId: session._id, athleteId: athlete._id, status, recordedBy: coach?._id ?? new ObjectId(), updatedAt: new Date() } }, { upsert: true });
    }
  }

  const matchInputs = [
    { team: football, session: pastFootballSessions[0], opponent: "St. Xavier's College", athlete: athleteByName.get("Aarav Mehta"), score: 2 },
    { team: football, session: pastFootballSessions[2], opponent: "Dumka District XI", athlete: athleteByName.get("Aarav Mehta"), score: 1 },
    { team: basketball, session: basketballSessions[0], opponent: "Dumka District XI", athlete: athleteByName.get("Nisha Sinha"), score: 18 },
    { team: basketball, session: basketballSessions[1], opponent: "St. Xavier's College", athlete: athleteByName.get("Nisha Sinha"), score: 22 },
  ];
  for (const item of matchInputs) {
    const match = await upsertDoc(matches, { organizationId, teamId: item.team._id, date: item.session.date, opponent: item.opponent }, {
      organizationId, sessionId: item.session._id, teamId: item.team._id, teamName: item.team.name, sport: item.team.sport,
      opponent: item.opponent, date: item.session.date, startTime: "16:30", createdBy: coach?._id ?? new ObjectId(), createdAt: new Date(),
    });
    await scores.updateOne({ organizationId, matchId: match._id, athleteId: item.athlete._id }, { $set: { organizationId, matchId: match._id, athleteId: item.athlete._id, score: item.score, recordedBy: coach?._id ?? new ObjectId(), updatedAt: new Date() } }, { upsert: true });
  }

  const today = dateDaysAgo(0);
  const openSession = await upsertDoc(sessions, { organizationId, teamId: football._id, date: today, title: "Skills & conditioning" }, {
    organizationId, teamId: football._id, teamName: football.name, sport: football.sport,
    title: "Skills & conditioning", date: today, startTime: "15:30", status: "open", createdBy: coach?._id ?? new ObjectId(), createdAt: new Date(),
  });
  for (const athlete of footballAthletes) await attendance.updateOne({ organizationId, sessionId: openSession._id, athleteId: athlete._id }, { $set: { organizationId, sessionId: openSession._id, athleteId: athlete._id, status: "absent", recordedBy: coach?._id ?? new ObjectId(), updatedAt: new Date() } }, { upsert: true });

  console.log(`Demo data is ready in ${databaseName}. Accounts were provisioned for admin, coach, scout, and player roles.`);
} finally {
  await client.close();
}
