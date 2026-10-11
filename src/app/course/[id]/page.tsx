import Link from "next/link";
import { notFound } from "next/navigation";
import InfoGrid, { type InfoCell } from "@/components/InfoGrid";
import NotifyButton from "@/components/NotifyButton";
import Shell from "@/components/Shell";
import { getCourse, type CourseWithStatus } from "@/db/queries";
import { ESTIMATE_NOTE, LOTTERY_NOTE, NO_PHONE, NO_SIGNAL, capacityHint, tiles, orgName, sourceName } from "@/lib/copy";
import { safeHttpUrl } from "@/lib/url";
import "./course.css";

const PHOTO: Record<string, string> = {
  춤: "dance",
  "몸 풀기": "yoga",
  악기: "instrument",
  노래: "sing",
  "미술·서예": "art",
  어학: "lang",
};

const md = (ymd: string) => `${Number(ymd.slice(5, 7))}/${Number(ymd.slice(8, 10))}`;
const korDate = (ymd: string) => `${Number(ymd.slice(5, 7))}월 ${Number(ymd.slice(8, 10))}일`;

function clock(t: string, withMeridiem = true): string {
  const [h, m] = t.split(":").map(Number);
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${withMeridiem ? (h < 12 ? "오전 " : "오후 ") : ""}${h12}:${String(m).padStart(2, "0")}`;
}

function timeRange(start: string | null, end: string | null): string | null {
  if (!start) return null;
  if (!end) return clock(start);
  const same = Number(start.slice(0, 2)) < 12 === Number(end.slice(0, 2)) < 12;
  return `${clock(start)}~${clock(end, !same)}`;
}

const WELCOME = /처음|누구나|환영|준비물 없/;

/** 설명에서 문턱 신호 문장 1줄. 신호가 없거나 설명이 없으면 null. */
function signalQuote(c: CourseWithStatus): string | null {
  const sig = c.signals as string[];
  if (!c.description || !(sig.includes("welcome") || sig.includes("no_supplies"))) return null;
  const hit = c.description
    .split(/(?<=[.!?。])\s+|\n+/)
    .map((s) => s.trim())
    .find((s) => WELCOME.test(s));
  if (!hit) return null;
  return hit.length > 90 ? `${hit.slice(0, 90)}…` : hit;
}

function backHref(sp: Record<string, string | string[] | undefined>): string {
  const q = new URLSearchParams();
  for (const k of ["st", "sido", "sigungu", "dong"]) {
    const v = sp[k];
    const one = Array.isArray(v) ? v[0] : v;
    if (one) q.set(k, one);
  }
  const s = q.toString();
  return s ? `/home?${s}` : "/home";
}

export default async function CoursePage({ params, searchParams }: PageProps<"/course/[id]">) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const c = await getCourse(id);
  if (!c) notFound();

  const t = tiles(c);
  const tile = (k: string) => t.find((x) => x.key === k)!;
  const photo = c.category ? PHOTO[c.category] : undefined;
  const lottery = c.selectionMethod === "추첨" || (c.signals as string[]).includes("lottery");
  const siteUrl = safeHttpUrl(c.detailUrl) ?? safeHttpUrl(c.homepageUrl);
  const org = orgName(c);
  const tel = c.phone ? `tel:${c.phone.replace(/[^\d+]/g, "")}` : null;
  const quote = signalQuote(c);
  const st = c.status;
  const always = st.status === "always";

  const when = [c.weekdays?.replace(/,/g, "·"), timeRange(c.startTime, c.endTime)].filter(Boolean).join(" ");
  const heroSub = [c.venue ?? c.institution, when].filter(Boolean).join(" · ");

  // contract §9·§12: round(term_days/7), 0.5 는 올림 — derive.py stair_reason 과 같은 주 수
  const weeks = c.termDays ? Math.round(c.termDays / 7) : null;
  const dets: Record<string, string | null> = {
    fee: c.feePeriod === "월" ? "한 달 단위 등록" : c.feePeriod === "총" ? "한 번에 내는 돈" : null,
    basic: tile("basic").tone === "good" && c.title.includes("기초") ? "강좌명에 「기초」" : null,
    capacity: capacityHint(c.capacity),
    selection: c.applyStart ? `${md(c.applyStart)}부터` : st.status === "always" || st.isEstimate ? c.ddayLabel : null,
    period: weeks ? `${weeks}주` : null,
    place: c.venue ?? "직접 가요",
  };
  const cells: InfoCell[] = t.map((x) => ({ k: x.label, v: x.value, d: dets[x.key], tile: x.key, tone: x.tone }));

  const pill = st.isEstimate ? c.ddayLabel.split(" · ")[0] : c.ddayLabel;

  return (
    <Shell>
      <main className="c-main">
        <div className="body">
          <Link href={backHref(sp)} className="c-back" aria-label="목록으로 돌아가기">
            <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span>목록</span>
          </Link>

          {photo ? (
            <figure className="c-cover">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/cat/${photo}.jpg`} alt="" />
            </figure>
          ) : null}
          <h1 className="c-title">{c.title}</h1>
          {heroSub ? <p className="c-where">{heroSub}</p> : null}
          <p className="c-src">
            {sourceName(c.source)} · {korDate(c.collectedAt)} 수집
          </p>

          <InfoGrid cells={cells} />

          <section className="c-sect c-signal" aria-labelledby="c-h-signal">
            <h2 id="c-h-signal">설명에서 찾은 문턱 신호</h2>
            <p>{quote ? `“${quote}”` : NO_SIGNAL}</p>
            {/* 신호를 가리키는 안내 고슴도치(장식) */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="c-guide" src="/char/h-guide.webp" alt="" aria-hidden="true" />
          </section>

          <section className="c-sect c-apply" aria-labelledby="c-h-apply">
            <h2 id="c-h-apply">접수</h2>
            <p className="c-big">{pill}</p>
            {st.isEstimate ? (
              <p className="c-note">
                {ESTIMATE_NOTE}
                {st.basisCount ? ` · 과거 ${st.basisCount}회 기준` : ""}
              </p>
            ) : null}
            {always ? (
              <>
                <p className="c-note">언제든 신청할 수 있어요. 궁금하면 전화로 물어보세요.</p>
                {c.phone ? <p className="c-bigphone">{c.phone}</p> : null}
              </>
            ) : null}
            {st.status === "unknown" ? (
              <>
                <p className="c-note">예측하지 않아요. 접수일은 기관에 전화로 물어보세요.</p>
                <p className="c-bigphone">{c.phone ?? NO_PHONE}</p>
              </>
            ) : null}
            {lottery ? <p className="c-note">{LOTTERY_NOTE}</p> : null}
          </section>

          <section className="c-sect" aria-labelledby="c-h-rev">
            <h2 id="c-h-rev">후기</h2>
            <p>아직 후기가 없어요</p>
          </section>

          <section className="c-sect" aria-labelledby="c-h-tel">
            <h2 id="c-h-tel">기관에 전화하기</h2>
            {tel ? (
              <a className="c-tel" href={tel}>
                {c.phone}
              </a>
            ) : always ? (
              <p className="c-note" data-always-nophone>
                언제든 동에 전화하거나 들르면 됩니다 · {NO_PHONE}
              </p>
            ) : (
              <p className="c-note">{NO_PHONE}</p>
            )}
          </section>
        </div>

        <div className="c-acts">
          {siteUrl ? (
            <a className="sbtn" data-apply href={siteUrl} target="_blank" rel="noopener noreferrer">
              <span>
                {org}에서 <span className="c-nw">신청하기<svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true">
                  <path d="M8 4H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-3M11 4h5v5M16 4l-7 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg></span>
              </span>
            </a>
          ) : (
            <p className="c-note c-noapply">신청은 기관에 전화로</p>
          )}
          {/* 접수 전(확정·예상 모두)일 때만 알림 버튼을 둔다. 연중·접수 중·마감·확인 안 됨은 알림 없이 위의 신청·전화 버튼만 둔다. */}
          {st.status === "before" ? <NotifyButton courseId={c.id} /> : null}
        </div>
      </main>
    </Shell>
  );
}
