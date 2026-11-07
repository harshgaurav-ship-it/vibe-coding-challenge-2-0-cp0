import { currentUser } from "@/lib/auth";
import { privateJson } from "@/lib/http";

export async function GET() {
  const user = await currentUser();
  if (!user) return privateJson({ user: null }, 401);
  return privateJson({ user });
}
