import { NextResponse } from "next/server";
import { listAreas } from "@/db/queries";

// 빌드 시점에 DB 가 비어 있거나(테이블 없음) 업로드 전이어도 빌드가 깨지지 않게
// 요청 시점에 조회한다. 실패하면 빈 목록을 돌려준다(화면은 예시 지역으로 폴백).
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await listAreas(), {
      headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" },
    });
  } catch (e) {
    console.error("[api/areas] 조회 실패:", e instanceof Error ? e.message : e);
    return NextResponse.json({ sido: [] }, { status: 200 });
  }
}
