import { clearSession } from "@/lib/auth";
import { privateJson, sameOriginFailure } from "@/lib/http";

export async function POST(request: Request) {
  const originFailure = sameOriginFailure(request);
  if (originFailure) return originFailure;
  await clearSession();
  return privateJson({ ok: true });
}
