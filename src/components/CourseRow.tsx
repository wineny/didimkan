import Link from "next/link";
import type { CourseWithStatus } from "@/db/queries";
import type { Category } from "@/db/schema";
import { capacityHint, feeLabel, UNKNOWN } from "@/lib/copy";

/** 서버에서 만들어 클라이언트 컴포넌트에도 넘기는 홈 카드용 값 (직렬화 가능) */
export type CourseView = {
  id: string;
  title: string;
  institution: string;
  category: Category | null;
  when: string;
  whenShort: string;
  fee: string;
  capacity: string | null;
  dday: string;
  reason: string;
  href: string;
  collectedAt: string;
  source: string;
};

const CAT_IMG: Record<Category, string> = {
  "몸 풀기": "yoga",
  춤: "dance",
  어학: "lang",
  "미술·서예": "art",
  악기: "instrument",
  노래: "sing",
};

/** 사진 경로. 분야가 없으면 null(옅은 면). 어학은 같은 분야가 나란히 나올 때 alt 로 번갈아 쓴다. */
export function photoOf(category: Category | null, alt = false): string | null {
  if (!category) return null;
  if (category === "어학" && alt) return "/cat/lang-b.jpg";
  return `/cat/${CAT_IMG[category]}.jpg`;
}

const DONG_GU: Record<string, string> = {
  jongno: "종로구",
  junggu: "중구",
  seongdong: "성동구",
  dongdaemun: "동대문구",
  gangbuk: "강북구",
  gwanak: "관악구",
  gangdong: "강동구",
  yongsan: "용산구",
  seongbuk: "성북구",
  seodaemun: "서대문구",
  guro: "구로구",
  songpa: "송파구",
  seocho: "서초구",
  nowon: "노원구",
};

function sourceName(source: string): string {
  if (source === "std" || source === "portal") return "공공데이터포털";
  if (source === "gangnam") return "강남구 통합예약";
  const gu = DONG_GU[source.replace(/^seoul_/, "")];
  return gu ? `${gu} 예약사이트` : "공식 사이트";
}

function clock(hhmm: string): { ap: string; h: number; m: number } {
  const [h, m] = hhmm.split(":").map(Number);
  return { ap: h < 12 ? "오전" : "오후", h: h % 12 === 0 ? 12 : h % 12, m };
}

function whenOf(c: CourseWithStatus): { long: string; short: string } {
  const wd = c.weekdays ? c.weekdays.split(",").join("·") : "";
  let long = "";
  let short = "";
  if (c.startTime) {
    const s = clock(c.startTime);
    short = `${s.ap} ${s.h}시${s.m ? ` ${s.m}분` : ""}`;
    long = `${s.ap} ${s.h}:${String(s.m).padStart(2, "0")}`;
    if (c.endTime && c.endTime !== "23:59") {
      const e = clock(c.endTime);
      long += `~${e.ap === s.ap ? "" : `${e.ap} `}${e.h}:${String(e.m).padStart(2, "0")}`;
    }
  }
  const join = (a: string, b: string) => [a, b].filter(Boolean).join(" ") || UNKNOWN;
  return { long: join(wd, long), short: join(wd, short) };
}

export function toView(c: CourseWithStatus, query: string): CourseView {
  const w = whenOf(c);
  return {
    id: c.id,
    title: c.title,
    institution: c.institution ?? UNKNOWN,
    category: c.category,
    when: w.long,
    whenShort: w.short,
    fee: feeLabel(c.feeWon, c.isFree, c.feePeriod),
    capacity: c.capacity == null ? null : `${c.capacity}명`,
    dday: c.ddayLabel,
    reason: c.stairReason ?? capacityHint(c.capacity) ?? "",
    href: `/course/${c.id}?${query}`,
    collectedAt: c.collectedAt,
    source: sourceName(c.source),
  };
}

/** 「출처 · 수집일」 한 줄용. 사진이 없으면(분야 없음) AI 이미지 문구는 뺀다. */
export function sourceLine(v: CourseView): string {
  const [, m, d] = v.collectedAt.split("-").map(Number);
  const ai = photoOf(v.category) ? " · AI 생성 시범 이미지" : "";
  return `${v.source} · ${m}월 ${d}일 수집${ai}`;
}

/** 목록 한 줄: 제목 · 센터 · 요일시간 · 접수 · 이유. 구분선 행. thumb 가 있으면 오른쪽에 사진. */
export default function CourseRow({
  v,
  label,
  thumb,
}: {
  v: CourseView;
  label?: string;
  thumb?: { src: string | null };
}) {
  return (
    <Link href={v.href} className="crow" data-course>
      <span className="crow-tx">
        {label && <span className="crow-lab">{label}</span>}
        <span className="crow-t">{v.title}</span>
        <span className="crow-m">
          {v.institution} · {v.when}
        </span>
        <span className="crow-m">
          {v.fee}
          {v.capacity ? ` · ${v.capacity}` : ""} · {v.dday}
        </span>
        {v.reason && <span className="crow-why">{v.reason}</span>}
      </span>
      {thumb &&
        (thumb.src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="th crow-th" src={thumb.src} alt="" />
        ) : (
          <span className="th crow-th crow-th-plain" aria-hidden="true" />
        ))}
    </Link>
  );
}
