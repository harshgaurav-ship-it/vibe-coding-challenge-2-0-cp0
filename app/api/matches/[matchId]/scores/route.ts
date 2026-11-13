import { createSaveScoreHandler } from "@/lib/route-handlers/save-score";

export const runtime = "nodejs";
export const POST = createSaveScoreHandler();
