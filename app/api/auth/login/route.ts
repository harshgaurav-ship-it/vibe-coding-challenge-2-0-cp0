import { createHmac } from "node:crypto";
import bcrypt from "bcryptjs";
import { createSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { privateJson, readJson, sameOriginFailure } from "@/lib/http";
import { loginSchema } from "@/lib/validation";
import type { UserDocument } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const originFailure = sameOriginFailure(request);
  if (originFailure) return originFailure;
  const parsedBody = await readJson(request);
  if (!parsedBody.ok) return privateJson({ error: parsedBody.error }, parsedBody.status);
  const parsed = loginSchema.safeParse(parsedBody.body);
  if (!parsed.success) return privateJson({ error: "Enter a valid email and password." }, 400);

  try {
    const db = await getDb();
    const email = parsed.data.email.toLowerCase();
    const secret = process.env.AUTH_SECRET;
    if (!secret || secret.length < 32) throw new Error("AUTH_SECRET must be at least 32 characters.");
    const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    const bucket = Math.floor(Date.now() / (15 * 60 * 1000));
    const key = createHmac("sha256", secret).update(`${forwarded}|${email}|${bucket}`).digest("hex");
    const attempts = db.collection("loginAttempts");
    await attempts.updateOne({ key }, { $inc: { count: 1 }, $setOnInsert: { expiresAt: new Date(Date.now() + 20 * 60 * 1000) } }, { upsert: true });
    const attempt = await attempts.findOne<{ count: number }>({ key });
    if ((attempt?.count ?? 0) > 8) return privateJson({ error: "Too many attempts. Wait a few minutes, then try again." }, 429);

    const user = await db.collection<UserDocument>("users").findOne({ email, active: true });
    if (!user || !(await bcrypt.compare(parsed.data.password, user.passwordHash))) {
      return privateJson({ error: "Email or password is incorrect." }, 401);
    }
    await attempts.deleteOne({ key });
    await createSession(user._id);
    return privateJson({ user: { id: String(user._id), name: user.name, email: user.email, role: user.role } });
  } catch {
    return privateJson({ error: "Sign in is temporarily unavailable. Check the database connection." }, 503);
  }
}
