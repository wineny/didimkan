"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Stair } from "@/db/schema";
import type { AreaTree } from "@/db/queries";
import { setArea } from "@/lib/storage";
import Button from "./Button";
import ChoiceList from "./ChoiceList";

type Props = { tree: AreaTree; stair: Stair };

const ALL = "";

function Chev() {
  return (
    <svg className="chev" width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
      <path d="M7.5 4.5L13 10l-5.5 5.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const WALK = { 1: "h-walk-seed", 2: "h-walk", 3: "h-walk-flower" } as const;

/** 제목 + 한 줄 + 오른쪽에 고른 단계 화분을 든 고슴도치(장식) */
function Heading({ title, sub, stair }: { title: string; sub: string | null; stair: Stair }) {
  return (
    <div className="m-hello">
      <div className="m-hello-tx">
        <h1 className="h1">{title}</h1>
        <p className="sub gap-sub">{sub}</p>
      </div>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="m-hello-img" src={`/char/${WALK[stair]}.webp`} alt="" aria-hidden="true" />
    </div>
  );
}

/** 시도 → 시군구 → 동 순서로 한 화면에 한 질문. 크게 보기에서는 구까지만 묻는다(R2). */
export default function WherePicker({ tree, stair }: Props) {
  const router = useRouter();
  const [step, setStep] = useState<"sido" | "sigungu" | "dong" | "done">("sido");
  const [sido, setSido] = useState<string | null>(null);
  const [sigungu, setSigungu] = useState<string | null>(null);
  const [dong, setDong] = useState(ALL);

  const sidoNode = tree.sido.find((s) => s.name === sido);
  const guNode = sidoNode?.sigungu.find((g) => g.name === sigungu);
  const dongs = guNode?.dong ?? [];

  function done() {
    if (!sido || !sigungu) return;
    setArea({ sido, sigungu, dong: dong || undefined });
    const q = new URLSearchParams({ st: String(stair), sido, sigungu });
    if (dong) q.set("dong", dong);
    router.push(`/home?${q.toString()}`);
  }

  function pickGu(g: string) {
    setSigungu(g);
    setDong(ALL);
    // 크게 보기이거나 동이 없으면 구에서 끝낸다
    const bigOn = document.documentElement.hasAttribute("data-big");
    const list = sidoNode?.sigungu.find((x) => x.name === g)?.dong ?? [];
    if (bigOn || list.length === 0) setStep("done");
    else setStep("dong");
  }

  const skip =
    stair === 1 ? (
      <Button variant="secondary" href="/home?st=1" className="gap-skip">
        동네는 건너뛰기
      </Button>
    ) : null;

  if (step === "sido") {
    return (
      <main className="body">
        <Heading title="어느 시·도에 사세요?" sub="가까운 곳부터 이어드릴게요." stair={stair} />
        <div className="opts gap-opts p-list">
          {tree.sido.map((s) => (
            <button
              key={s.name}
              type="button"
              className="li"
              data-sido={s.name}
              onClick={() => {
                setSido(s.name);
                setStep("sigungu");
              }}
            >
              {s.name}
              <Chev />
            </button>
          ))}
        </div>
        {skip}
      </main>
    );
  }

  if (step === "sigungu") {
    return (
      <main className="body">
        <Heading title="어느 구·시예요?" sub={sido} stair={stair} />
        <div className="opts gap-opts p-list">
          {(sidoNode?.sigungu ?? []).map((g) => (
            <button key={g.name} type="button" className="li" data-sigungu={g.name} onClick={() => pickGu(g.name)}>
              {g.name}
              <Chev />
            </button>
          ))}
        </div>
        <Button variant="secondary" className="gap-skip" onClick={() => setStep("sido")}>
          이전으로
        </Button>
        {skip}
      </main>
    );
  }

  const items = [{ value: ALL, title: `${sigungu} 전체` }, ...dongs.map((d) => ({ value: d, title: d }))];

  return (
    <>
      <main className="body">
        <Heading
          title={step === "dong" ? "가까운 동이 있나요?" : "이 동네로 볼게요"}
          sub={step === "dong" ? `${sido} ${sigungu}에서 고르세요. 안 골라도 돼요.` : `${sido} ${sigungu}`}
          stair={stair}
        />
        {step === "dong" && (
          <div className="gap-opts">
            <ChoiceList items={items} selected={dong} onSelect={setDong} dataAttr="data-dong" label="가까운 동" />
          </div>
        )}
        <Button variant="secondary" className="gap-skip" onClick={() => setStep("sigungu")}>
          이전으로
        </Button>
        {skip}
      </main>
      <Button data-next onClick={done}>
        계단 보기
      </Button>
    </>
  );
}
