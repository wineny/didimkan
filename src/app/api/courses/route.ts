import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { listCourses } from "@/db/queries";
import { EMPTY_LIST } from "@/lib/copy";
import { getToday } from "@/lib/today";

export const revalidate = 3600;

const text = z.string().trim().min(1).max(40);
const query = z.object({
  stair: z.coerce.number().int().min(1).max(3),
  sido: text.optional(),
  sigungu: text.optional(),
  dong: text.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

export async function GET(req: NextRequest) {
  const raw = Object.fromEntries(req.nextUrl.searchParams);
  const parsed = query.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") },
      { status: 400 },
    );
  }
  const { stair, sido, sigungu, dong, limit } = parsed.data;
  const today = getToday();
  const items = await listCourses({
    stair: stair as 1 | 2 | 3,
    area: { sido, sigungu, dong },
    today,
    limit,
  });
  return NextResponse.json({
    items,
    today,
    ...(items.length === 0 ? { empty_text: EMPTY_LIST } : {}),
  });
}
