"use client";

import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import type { Stair } from "@/db/schema";
import { NEXT_SLOT_STAIR3, STEP_LABELS } from "@/lib/copy";
import { photoOf, type CourseView } from "./CourseRow";

function subscribe(onChange: () => void) {
  const mo = new MutationObserver(onChange);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-big"] });
  return () => mo.disconnect();
}
const readBig = () => document.documentElement.hasAttribute("data-big");

type Props = {
  st: Stair;
  nowItems: CourseView[];
  nextItems: CourseView[];
};

function tag(n: number, st: Stair): string {
  if (n === st) return `${n}단 · 지금 여기`;
  if (n === st + 1) return `${n}단 · 다음 칸`;
  return `${n}단`;
}

function Check() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="#fff" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** 큰 글자 카드 한 장: 칸 이름 + 강좌 1개 + 「더 보기」 */
function BigCard({
  now,
  head,
  items,
  stepAttr,
  note,
}: {
  now: boolean;
  head: [string, string];
  items: CourseView[];
  stepAttr: number;
  note?: string;
}) {
  const [open, setOpen] = useState(false);
  const shown = open ? items : items.slice(0, 1);
  return (
    <div
      className={now ? "bstep on" : "bstep"}
      data-step={stepAttr}
      {...(now ? { "data-now": "true" } : {})}
    >
      <div className="bstep-hd">
        <span className={now ? "bstep-dot cur" : "bstep-dot nxt"} aria-hidden="true" />
        <span className="bstep-t">
          {head[0]} <span>{head[1]}</span>
        </span>
      </div>
      {note && <p className="bstep-note">{note}</p>}
      {shown.map((v) => {
        const src = photoOf(v.category);
        return (
          <Link key={v.id} href={v.href} className="bstep-c" data-course>
            {src ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="bstep-th" src={src} alt="" />
            ) : (
              <span className="bstep-th bstep-th-plain" aria-hidden="true" />
            )}
            <span className="bstep-tx">
              <span className="bstep-ct">{v.title}</span>
              <span className="bstep-cm">
                {v.institution} · {v.whenShort}
              </span>
              <span className="bstep-cm">{v.dday}</span>
            </span>
          </Link>
        );
      })}
      {items.length > 1 && (
        <button type="button" className="bstep-more" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? "접기" : `더 보기 (${items.length - 1}개)`}
        </button>
      )}
    </div>
  );
}

/**
 * 계단 스테퍼. 일반: 원 3개 + 선 + 카드 3장(data-step 3개).
 * 크게 보기(html[data-big]): 지금 칸·다음 칸 두 장을 세로로 쌓은 카드(data-step 2개).
 * 서버 렌더는 항상 일반, 마운트 뒤 data-big 을 보고 바꾼다.
 */
export default function Stepper({ st, nowItems, nextItems }: Props) {
  const big = useSyncExternalStore(subscribe, readBig, () => false);

  if (big) {
    const hasNext = st < 3;
    return (
      <div className="bsteps" aria-label={`3단 중 ${st}단이 지금 여기`}>
        <BigCard now head={[`${st}단`, "· 지금 여기"]} items={nowItems} stepAttr={st} />
        <BigCard
          now={false}
          head={hasNext ? [`${st + 1}단`, "· 다음 칸"] : ["다음 칸", ""]}
          items={nextItems}
          stepAttr={hasNext ? st + 1 : 3}
          note={hasNext ? undefined : NEXT_SLOT_STAIR3}
        />
      </div>
    );
  }

  const progress = `${((st - 1) / 2) * 100}%`;
  return (
    <div
      className="stp"
      style={{ "--p": progress } as React.CSSProperties}
      aria-label={`3단 중 ${st}단이 지금 여기${st < 3 ? `, ${st + 1}단이 다음 칸` : ""}`}
    >
      <div className="stp-axis" />
      {([1, 2, 3] as const).map((n) => {
        const now = n === st;
        return (
          <div key={n} className="stp-mk" data-step={n} {...(now ? { "data-now": "true" } : {})}>
            <div className={now ? "stp-dot cur" : n < st ? "stp-dot done" : "stp-dot nxt"}>{n < st && <Check />}</div>
            <div className={now ? "stp-card on" : "stp-card"}>
              <div className="t">{tag(n, st)}</div>
              <div className="d">{STEP_LABELS[n]}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
