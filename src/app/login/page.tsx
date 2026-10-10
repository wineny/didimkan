import { redirect } from "next/navigation";
import LoginForm, { type LoginCourse } from "@/components/LoginForm";
import Shell from "@/components/Shell";
import { getCourse } from "@/db/queries";
import { getSession } from "@/lib/auth";
import { M2_COPY, orgName } from "@/lib/copy";
import { koreanDate } from "@/lib/notify";
import { safeNext } from "@/lib/url";

const KEEP = ["st", "sido", "sigungu", "dong"] as const;

function one(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const sp = await searchParams;
  const courseId = one(sp.course);
  const next = one(sp.next) || null;

  const q = new URLSearchParams();
  for (const k of KEEP) if (one(sp[k])) q.set(k, one(sp[k]));
  const qs = q.toString();
  const skipHref = courseId ? `/course/${encodeURIComponent(courseId)}${qs ? `?${qs}` : ""}` : "/";

  const c = courseId ? await getCourse(courseId).catch(() => null) : null;
  let course: LoginCourse | null = null;
  if (c) {
    const st = c.status;
    const when = st.status === "before" && st.date ? ` · ${koreanDate(st.date)}${st.isEstimate ? " 접수 예상" : " 접수"}` : "";
    course = { id: c.id, title: c.title, line: `${orgName(c)}${when}` };
  }

  let loggedIn = false;
  try {
    loggedIn = (await getSession()) !== null;
  } catch {
    loggedIn = false;
  }
  // 강좌 없이 이미 로그인한 사람은 갈 곳으로 바로 보낸다 (next 가 없으면 내 알림)
  // (상대 경로만 통과시키는 검사라 origin 값은 비교용일 뿐이다. 로그인 화면으로 되돌아가는 고리는 막는다)
  if (loggedIn && !course) {
    const to = safeNext(next, "http://localhost");
    redirect(to.startsWith("/login") ? "/me" : to);
  }

  return (
    <Shell foot="실제 접수는 기관에 확인하세요">
      <main className="m-main" aria-label={M2_COPY.login.h1}>
        <LoginForm course={course} skipHref={skipHref} next={next} loggedIn={loggedIn} />
      </main>
    </Shell>
  );
}
