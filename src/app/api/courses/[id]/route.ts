import { NextResponse, type NextRequest } from "next/server";
import { getCourse } from "@/db/queries";
import { getToday } from "@/lib/today";

export const revalidate = 3600;

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (id.length > 64) {
    return NextResponse.json({ error: "찾을 수 없어요" }, { status: 404 });
  }
  const today = getToday();
  const course = await getCourse(id, today);
  if (!course) {
    return NextResponse.json({ error: "찾을 수 없어요" }, { status: 404 });
  }
  return NextResponse.json({ course, today });
}
