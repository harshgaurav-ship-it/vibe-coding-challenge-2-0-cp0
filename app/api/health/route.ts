import { checkDatabase } from "@/lib/db";
import { privateJson } from "@/lib/http";

export const runtime = "nodejs";

export async function GET() {
  try {
    await checkDatabase();
    return privateJson({ status: "ok", database: "connected" });
  } catch {
    return privateJson({ status: "unavailable", database: "not connected" }, 503);
  }
}
