import Link from "next/link";
import { listCourses } from "@/db/queries";

/** 「강좌」 탭: 2단 홈 목록의 첫 강좌. id 는 빌드마다 바뀌므로 고정하지 않는다. DB 를 못 읽으면 홈. */
async function firstCourseHref(): Promise<string> {
  try {
    const [first] = await listCourses({ stair: 2, limit: 1 });
    return first ? `/course/${first.id}?st=2` : "/home?st=2";
  } catch {
    return "/home?st=2";
  }
}

/** ?dev=1 일 때만 보이는 화면 점프 (개발용) */
export default async function DevTabs() {
  const tabs = [
    ["01 상태", "/"],
    ["동네", "/where?st=2"],
    ["홈", "/home?st=2"],
    ["강좌", await firstCourseHref()],
  ] as const;
  return (
    <nav className="devtabs" aria-label="개발용 화면 이동">
      {tabs.map(([label, href]) => (
        <Link key={label} href={href}>
          {label}
        </Link>
      ))}
    </nav>
  );
}
