import Link from "next/link";

const TABS = [
  ["01 상태", "/"],
  ["동네", "/where?st=2"],
  ["홈", "/home?st=2"],
  ["강좌", "/course/9632?st=2"],
] as const;

/** ?dev=1 일 때만 보이는 화면 점프 (개발용) */
export default function DevTabs() {
  return (
    <nav className="devtabs" aria-label="개발용 화면 이동">
      {TABS.map(([label, href]) => (
        <Link key={href} href={href}>
          {label}
        </Link>
      ))}
    </nav>
  );
}
