"use client";

import { useRouter } from "next/navigation";
import { useSyncExternalStore } from "react";
import type { Stair } from "@/db/schema";
import { STAIR_SUB } from "@/lib/copy";
import { getStair, setStair } from "@/lib/storage";
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

export default function StairChoice() {
  const router = useRouter();
  // 서버 렌더는 기본 2단, 브라우저에서 저장된 값이 있으면 그걸로 바뀐다.
  const stair = useSyncExternalStore(subscribe, getStair, () => 2 as Stair);

  const items = ([1, 2, 3] as const).map((k) => ({ value: String(k), title: TITLES[k], sub: STAIR_SUB[k] }));

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
        <p className="note">로그인하지 않아도 볼 수 있어요</p>
      </main>
      <Button data-next onClick={() => router.push(`/where?st=${stair}`)}>
        다음
      </Button>
    </>
  );
}
