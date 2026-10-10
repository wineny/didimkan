"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSyncExternalStore } from "react";
import type { Stair } from "@/db/schema";
import { STAIR_SUB } from "@/lib/copy";
import { getArea, getStair, setStair } from "@/lib/storage";
import Button from "./Button";
import ChoiceList from "./ChoiceList";

/** v4 index.html 01 상태 질문의 선택지 원문 */
const TITLES: Record<Stair, string> = {
  1: "집에서 조용히 시작하고 싶어요",
  2: "한 번쯤은 나가볼 수 있어요",
  3: "정기적으로 다닐 곳을 찾고 있어요",
};

const listeners = new Set<() => void>();
function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => void listeners.delete(cb);
}

/** R1: 지난번 고른 동네로 바로 홈 목록을 연다. */
function resumeHref(stair: Stair, area: ReturnType<typeof getArea>): string {
  const q = new URLSearchParams({ st: String(stair) });
  for (const k of ["sido", "sigungu", "dong"] as const) {
    const v = area[k];
    if (v) q.set(k, v);
  }
  return `/home?${q.toString()}`;
}

export default function StairChoice() {
  const router = useRouter();
  // 서버 렌더는 기본 2단, 브라우저에서 저장된 값이 있으면 그걸로 바뀐다.
  const stair = useSyncExternalStore(subscribe, getStair, () => 2 as Stair);

  // 저장된 동네(JSON 문자열로 비교해야 매번 새 객체가 아니어서 다시 그리기가 멈춘다)
  const areaJson = useSyncExternalStore(subscribe, () => JSON.stringify(getArea()), () => "{}");
  const area = JSON.parse(areaJson) as ReturnType<typeof getArea>;
  const resume = area.sido ? resumeHref(stair, area) : null;
  const resumeLabel = [area.sigungu ?? area.sido, area.dong].filter(Boolean).join(" ");

  const items = ([1, 2, 3] as const).map((k) => ({ value: String(k), title: TITLES[k], sub: STAIR_SUB[k], stair: k }));

  return (
    <>
      <main className="body">
        <h1 className="h1 gap-h1">요즘 어떠세요?</h1>
        <p className="sub gap-sub">
          배우고 싶은 게 없어도 괜찮아요.
          <br />
          지금 어디까지 나갈 수 있는지만 골라주세요.
        </p>
        <div className="gap-opts">
          <ChoiceList
            items={items}
            selected={String(stair)}
            dataAttr="data-choice"
            label="요즘 어디까지 나갈 수 있나요"
            onSelect={(v) => {
              setStair(Number(v) as Stair);
              listeners.forEach((l) => l());
            }}
          />
        </div>
        {resume ? (
          <Link href={resume} className="sbtn gap-skip" data-resume>
            이어서 보기 · {resumeLabel}
          </Link>
        ) : null}
        <p className="note">로그인하지 않아도 볼 수 있어요</p>
      </main>
      <Button data-next onClick={() => router.push(`/where?st=${stair}`)}>
        다음
      </Button>
    </>
  );
}
