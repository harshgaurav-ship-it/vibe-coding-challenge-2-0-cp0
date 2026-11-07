import bcrypt from "bcryptjs";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { authorize } from "@/lib/auth";
import { getDb, withDbTransaction } from "@/lib/db";
import { privateJson, readJson, sameOriginFailure } from "@/lib/http";
import type { UserDocument } from "@/lib/types";

export const runtime = "nodejs";

const staffSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.string().trim().email().max(254),
  role: z.enum(["coach", "scout"]),
  password: z.string().min(12).max(128),
});

export async function GET() {
  const access = await authorize(["admin"]);
  if (!access.user) return privateJson({ error: access.error }, access.status);
  try {
    const db = await getDb();
    const staff = await db.collection<UserDocument>("users")
      .find({ organizationId: new ObjectId(access.user.organizationId), role: { $in: ["admin", "coach", "scout"] }, active: true })
      .project({ name: 1, email: 1, role: 1 })
      .sort({ role: 1, name: 1 }).toArray();
    return privateJson({ staff: staff.map((person) => ({ id: String(person._id), name: person.name, email: person.email, role: person.role })) });
  } catch {
    return privateJson({ error: "Unable to load staff accounts." }, 503);
  }
}

export async function POST(request: Request) {
  const originFailure = sameOriginFailure(request);
  if (originFailure) return originFailure;
  const access = await authorize(["admin"]);
  if (!access.user) return privateJson({ error: access.error }, access.status);
  const body = await readJson(request);
  if (!body.ok) return privateJson({ error: body.error }, body.status);
  const parsed = staffSchema.safeParse(body.body);
  if (!parsed.success) return privateJson({ error: "Enter a name, valid email, coach or scout role, and a password with at least 12 characters." }, 400);
  try {
    const email = parsed.data.email.toLowerCase();
    const organizationId = new ObjectId(access.user.organizationId);
    const passwordHash = await bcrypt.hash(parsed.data.password, 12);
    const staffId = await withDbTransaction(async (db, session) => {
      if (await db.collection("users").findOne({ email }, { session })) throw Object.assign(new Error("An account already uses that email."), { status: 409 });
      const result = await db.collection("users").insertOne({
        organizationId, name: parsed.data.name, email, passwordHash,
        role: parsed.data.role, active: true, createdAt: new Date(),
      }, { session });
      await db.collection("auditEvents").insertOne({
        organizationId, actorId: new ObjectId(access.user!.id), action: "staff.created",
        entity: "user", entityId: result.insertedId, details: { role: parsed.data.role }, createdAt: new Date(),
      }, { session });
      return result.insertedId;
    });
    return privateJson({ staff: { id: String(staffId), name: parsed.data.name, email, role: parsed.data.role } }, 201);
  } catch (error) {
    if (error && typeof error === "object" && "status" in error && error.status === 409) return privateJson({ error: "An account already uses that email." }, 409);
    if (error && typeof error === "object" && "code" in error && error.code === 11000) {
      return privateJson({ error: "An account already uses that email." }, 409);
    }
    return privateJson({ error: "Unable to create the staff account." }, 503);
  }
}
