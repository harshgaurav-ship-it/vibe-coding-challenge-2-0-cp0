import { createSessionUpdateHandler } from "@/lib/route-handlers/session-update";

export const runtime = "nodejs";
export const PATCH = createSessionUpdateHandler();
