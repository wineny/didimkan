import Link from "next/link";
import { getSession } from "@/lib/auth";
import BigToggle from "./BigToggle";

/** 로그인 상태를 못 읽으면(DB 오류 등) 로그인 전 화면으로 보여 준다. */
async function isLoggedIn(): Promise<boolean> {
  try {
    return (await getSession()) !== null;
  } catch {
    return false;
  }
}

export default async function TopBar() {
  const loggedIn = await isLoggedIn();
  return (
    <header className="top">
      <div className="logo" role="img" aria-label="디딤칸">
        <svg width="24" height="24" viewBox="0 0 39 39" aria-hidden="true">
          <rect x="0" y="26" width="13" height="13" fill="var(--logo-ink)" />
          <rect x="13" y="13" width="13" height="26" fill="var(--logo-ink)" />
          <rect x="26" y="0" width="13" height="13" fill="var(--accent)" />
        </svg>
        <b>
          디딤칸<i>.</i>
        </b>
      </div>
      <div className="tbtns">
        <BigToggle />
        {loggedIn ? (
          <Link data-me className="tbtn tbtn-me" href="/me">
            내 알림
          </Link>
        ) : (
          <Link data-login className="tbtn tbtn-login" href="/login">
            로그인
          </Link>
        )}
      </div>
    </header>
  );
}
