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
