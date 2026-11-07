import "server-only";
import { cookies } from "next/headers";
import { ObjectId } from "mongodb";
import { jwtVerify, SignJWT } from "jose";
import { getDb } from "@/lib/db";
import type { AuthUser, UserDocument, UserRole } from "@/lib/types";

const COOKIE_NAME = "fieldhouse_session";
const SESSION_AGE_SECONDS = 60 * 60 * 24 * 7;

function secretKey() {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) throw new Error("AUTH_SECRET must be at least 32 characters.");
  return new TextEncoder().encode(secret);
}

function serializeUser(user: UserDocument): AuthUser {
  return {
    id: String(user._id),
    organizationId: String(user.organizationId),
    name: user.name,
    email: user.email,
    role: user.role,
    athleteId: user.athleteId ? String(user.athleteId) : undefined,
  };
}

export async function createSession(userId: ObjectId) {
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(userId))
    .setIssuedAt()
    .setExpirationTime(`${SESSION_AGE_SECONDS}s`)
    .sign(secretKey());

  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_AGE_SECONDS,
  });
}

export async function clearSession() {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
}

export async function currentUser(): Promise<AuthUser | null> {
  const token = (await cookies()).get(COOKIE_NAME)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey(), { algorithms: ["HS256"] });
    if (!payload.sub || !ObjectId.isValid(payload.sub)) return null;
    const db = await getDb();
    const user = await db.collection<UserDocument>("users").findOne({
      _id: new ObjectId(payload.sub),
      active: true,
    });
    return user ? serializeUser(user) : null;
  } catch {
    return null;
  }
}

export async function authorize(roles?: UserRole[]) {
  const user = await currentUser();
  if (!user) return { user: null, status: 401 as const, error: "Sign in to continue." };
  if (roles && !roles.includes(user.role)) {
    return { user: null, status: 403 as const, error: "Your account cannot perform this action." };
  }
  return { user, status: 200 as const, error: "" };
}
