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

/** 계단 칸 위의 작은 글자: 지금 칸은 「지금 여기」, 바로 위 칸은 「다음 칸」 */
function tag(n: number, st: Stair): string | null {
  if (n === st) return "지금 여기";
  if (n === st + 1) return "다음 칸";
  return null;
}

/** 칸 위 장식 그림: 칸마다 씨앗·새싹·꽃 화분, 지금 칸은 그 화분을 든 고슴도치 */
const POT = { 1: "seed", 2: "sprout", 3: "flower" } as const;
const WALK = { 1: "h-walk-seed", 2: "h-walk", 3: "h-walk-flower" } as const;

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
            {src && (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="bstep-th" src={src} alt="" />
            )}
            <span className="bstep-tx">
              <span className="bstep-ct">{v.title}</span>
              <span className="bstep-cm">
                {v.institution}
                {v.whenKnown ? ` · ${v.whenShort}` : ""}
              </span>
              <span className="bstep-cm">{v.applyKnown ? v.dday : v.unknownLine}</span>
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
 * 계단 스테퍼. 일반: 높이가 다른 3칸 계단(data-step 3개). 지금 칸은 테라코타 옅은 면, 다음 칸은 보조 면.
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

  return (
    <div className="stairs" aria-label={`3단 중 ${st}단이 지금 여기${st < 3 ? `, ${st + 1}단이 다음 칸` : ""}`}>
      {([1, 2, 3] as const).map((n) => {
        const now = n === st;
        const k = tag(n, st);
        return (
          <div
            key={n}
            className={`step s${n}${now ? " on" : n === st + 1 ? " nx" : ""}`}
            data-step={n}
            {...(now ? { "data-now": "true" } : {})}
          >
            <span className="n">
              {n}
              <small>단</small>
            </span>
            {k && <span className="k">{k}</span>}
            <span className="t">{STEP_LABELS[n]}</span>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              className={now ? "step-art hog" : "step-art pot"}
              src={now ? `/char/${WALK[n]}.webp` : `/char/i-pot-${POT[n]}.webp`}
              alt=""
              aria-hidden="true"
            />
          </div>
        );
      })}
    </div>
  );
}
