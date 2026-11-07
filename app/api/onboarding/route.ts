import bcrypt from "bcryptjs";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { createSession } from "@/lib/auth";
import { withDbTransaction } from "@/lib/db";
import { privateJson, readJson, sameOriginFailure } from "@/lib/http";

export const runtime = "nodejs";

const organizationSchema = z.object({
  organizationName: z.string().trim().min(3).max(100),
  organizationType: z.enum(["academy", "school", "college"]),
  city: z.string().trim().max(80).optional().default(""),
  adminName: z.string().trim().min(2).max(100),
  email: z.string().trim().email().max(254),
  password: z.string().min(12).max(128),
});

function slugify(value: string) {
  return value.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 70);
}

export async function POST(request: Request) {
  const originFailure = sameOriginFailure(request);
  if (originFailure) return originFailure;
  const body = await readJson(request);
  if (!body.ok) return privateJson({ error: body.error }, body.status);
  const parsed = organizationSchema.safeParse(body.body);
  if (!parsed.success) return privateJson({ error: "Complete the institution and administrator details. Use a password with at least 12 characters." }, 400);

  try {
    if (!process.env.AUTH_SECRET || process.env.AUTH_SECRET.length < 32) throw new Error("AUTH_SECRET must be at least 32 characters.");
    const email = parsed.data.email.toLowerCase();
    const slugBase = slugify(parsed.data.organizationName) || "institution";
    const slug = slugBase + "-" + new ObjectId().toHexString().slice(0, 6);

    const now = new Date();
    const passwordHash = await bcrypt.hash(parsed.data.password, 12);
    const userId = await withDbTransaction(async (db, session) => {
      if (await db.collection("users").findOne({ email }, { session })) throw Object.assign(new Error("An account already uses that email."), { status: 409 });
      const organizationResult = await db.collection("organizations").insertOne({
        name: parsed.data.organizationName, slug, type: parsed.data.organizationType,
        city: parsed.data.city, timezone: "Asia/Kolkata", createdAt: now,
      }, { session });
      const newUserId = new ObjectId();
      await db.collection("users").insertOne({
        _id: newUserId, organizationId: organizationResult.insertedId,
        name: parsed.data.adminName, email, passwordHash, role: "admin", active: true, createdAt: now,
      }, { session });
      await db.collection("auditEvents").insertOne({ organizationId: organizationResult.insertedId, actorId: newUserId, action: "organization.created", entity: "organization", entityId: organizationResult.insertedId, createdAt: now }, { session });
      return newUserId;
    });
    await createSession(userId);
    return privateJson({ ok: true, user: { id: String(userId), name: parsed.data.adminName, email, role: "admin" } }, 201);
  } catch (error) {
    if (error && typeof error === "object" && "status" in error && error.status === 409) return privateJson({ error: "An account already uses that email." }, 409);
    if (error && typeof error === "object" && "code" in error && error.code === 11000) {
      return privateJson({ error: "This institution or email is already registered." }, 409);
    }
    return privateJson({ error: "Unable to create the institution workspace. Check the database connection." }, 503);
  }
}
