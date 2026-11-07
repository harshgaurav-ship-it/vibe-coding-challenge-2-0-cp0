import "server-only";
import { MongoClient, type ClientSession, type Db } from "mongodb";

const uri = process.env.MONGODB_URI;
const databaseName = process.env.MONGODB_DB?.trim();

declare global {
  var fieldhouseMongoPromise: Promise<MongoClient> | undefined;
  var fieldhouseIndexesPromise: Promise<void> | undefined;
}

function mongoClientPromise() {
  if (!uri) throw new Error("MONGODB_URI is not configured.");
  if (!global.fieldhouseMongoPromise) {
    global.fieldhouseMongoPromise = new MongoClient(uri, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 8000,
    }).connect().catch((error: unknown) => {
      global.fieldhouseMongoPromise = undefined;
      throw error;
    });
  }
  return global.fieldhouseMongoPromise;
}

export async function getMongoClient() {
  return mongoClientPromise();
}

export async function getDb() {
  if (!databaseName) throw new Error("MONGODB_DB is not configured. Set an explicit database name for this environment.");
  const db = (await getMongoClient()).db(databaseName);
  if (!global.fieldhouseIndexesPromise) {
    global.fieldhouseIndexesPromise = Promise.all([
      db.collection("users").createIndex({ email: 1 }, { unique: true }),
      db.collection("organizations").createIndex({ slug: 1 }, { unique: true }),
      db.collection("teams").createIndex({ organizationId: 1, name: 1, sport: 1, season: 1 }, { unique: true }),
      db.collection("athletes").createIndex({ organizationId: 1, studentId: 1 }, { unique: true }),
      db.collection("sessions").createIndex({ organizationId: 1, teamId: 1, date: 1, startTime: 1, title: 1 }, { unique: true }),
      db.collection("attendance").createIndex({ organizationId: 1, sessionId: 1, athleteId: 1 }, { unique: true }),
      db.collection("matches").createIndex({ organizationId: 1, teamId: 1, date: 1, opponent: 1 }, { unique: true }),
      db.collection("matchScores").createIndex({ organizationId: 1, matchId: 1, athleteId: 1 }, { unique: true }),
      db.collection("loginAttempts").createIndex({ key: 1 }, { unique: true }),
      db.collection("loginAttempts").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
      db.collection("auditEvents").createIndex({ organizationId: 1, createdAt: -1 }),
    ]).then(() => undefined).catch((error: unknown) => {
      global.fieldhouseIndexesPromise = undefined;
      throw error;
    });
  }
  await global.fieldhouseIndexesPromise;
  return db;
}

export async function withDbTransaction<T>(operation: (db: Db, session: ClientSession) => Promise<T>): Promise<T> {
  const db = await getDb();
  const client = await getMongoClient();
  const session = client.startSession();
  let result!: T;
  try {
    await session.withTransaction(async () => {
      result = await operation(db, session);
    });
    return result;
  } finally {
    await session.endSession();
  }
}

export async function checkDatabase() {
  const db = await getDb();
  await db.command({ ping: 1 });
  return true;
}
