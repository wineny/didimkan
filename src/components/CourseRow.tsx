import Link from "next/link";
import type { CourseWithStatus } from "@/db/queries";
import type { Category } from "@/db/schema";
import { capacityHint, feeLabel, UNKNOWN, unknownLine } from "@/lib/copy";

/** 서버에서 만들어 클라이언트 컴포넌트에도 넘기는 홈 카드용 값 (직렬화 가능) */
export type CourseView = {
  id: string;
  title: string;
  institution: string;
  category: Category | null;
  when: string;
  whenShort: string;
  /** 요일·시간을 하나라도 알면 true. 모르면 when 줄을 빼고 unknownLine 에 모은다 */
  whenKnown: boolean;
  fee: string;
  feeKnown: boolean;
  capacity: string | null;
  dday: string;
  /** 접수 상태를 알면 true(접수 전·중·연중·지난 회차). 모르면 dday 칩을 빼고 unknownLine 에 모은다 */
  applyKnown: boolean;
  /** 접수 전·접수 중·연중이면 true (테라코타 칩), 지난 회차·확인 안 됨이면 false (옅은 칩) */
  ddayOn: boolean;
  /** 「요일·수강료·접수일 확인 안 됨」처럼 모르는 값을 한 줄로. 다 알면 null */
  unknownLine: string | null;
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
  const whenKnown = w.long !== UNKNOWN;
  const feeKnown = !!c.isFree || c.feeWon != null;
  const applyKnown = c.status.status !== "unknown";
  return {
    id: c.id,
    title: c.title,
    institution: c.institution ?? UNKNOWN,
    category: c.category,
    when: w.long,
    whenShort: w.short,
    whenKnown,
    fee: feeLabel(c.feeWon, c.isFree, c.feePeriod),
    feeKnown,
    capacity: c.capacity == null ? null : `${c.capacity}명`,
    dday: c.ddayLabel,
    applyKnown,
    ddayOn: c.status.status === "before" || c.status.status === "open" || c.status.status === "always",
    unknownLine: unknownLine({ when: whenKnown, fee: feeKnown, apply: applyKnown }),
    reason: c.stairReason ?? capacityHint(c.capacity) ?? "",
    href: `/course/${c.id}?${query}`,
    collectedAt: c.collectedAt,
    source: sourceName(c.source),
  };
}

/** 「수강료 · 정원」 칩 글자. 수강료를 모르면 정원만, 둘 다 없으면 null(모르는 값은 unknownLine 으로). */
export function feeChip(v: CourseView): string | null {
  const parts = [v.feeKnown ? v.fee : null, v.capacity].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

/** 「출처 · 수집일」 한 줄용 (홈 대표 강좌). 대표 강좌는 사진을 싣지 않으므로 AI 이미지 문구는 화면 아래 줄에 둔다. */
export function sourceLine(v: CourseView): string {
  const [, m, d] = v.collectedAt.split("-").map(Number);
  return `${v.source} · ${m}월 ${d}일 수집`;
}

/**
 * 홈 목록 카드 (A2): 번호 · 제목 · 센터 · 요일시간 · 칩(수강료·정원 / 접수) · 이유(테라코타 세로선).
 * thumb.src 가 있으면(다음 칸) 사진을 위에 두고 이유는 사진 설명으로 붙인다. 글자는 사진 아래.
 */
export default function CourseRow({
  v,
  no,
  label,
  thumb,
}: {
  v: CourseView;
  no?: number;
  label?: string;
  thumb?: { src: string | null };
}) {
  const photo = thumb?.src ?? null;
  return (
    <Link href={v.href} className={photo ? "crow crow-photo" : "crow"} data-course>
      {no != null && <span className="crow-no">{String(no).padStart(2, "0")}</span>}
      {photo && (
        <span className="crow-ph">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={photo} alt="" />
          {v.reason && <span className="crow-why">{v.reason}</span>}
        </span>
      )}
      {label && <span className="crow-lab">{label}</span>}
      <span className="crow-t">{v.title}</span>
      <span className="crow-m">{v.institution}</span>
      {v.whenKnown && <span className="crow-m">{v.when}</span>}
      <span className="crow-tags">
        {feeChip(v) && <span className="chip off">{feeChip(v)}</span>}
        {v.applyKnown && <span className={v.ddayOn ? "chip" : "chip off"}>{v.dday}</span>}
        {v.unknownLine && <span className="chip off">{v.unknownLine}</span>}
      </span>
      {!photo && v.reason && <span className="crow-why">{v.reason}</span>}
    </Link>
  );
}
