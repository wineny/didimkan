"use client";

import { markIntroSeen } from "@/lib/storage";
import Button from "./Button";

/** 첫 방문 소개: 계단 오르는 고슴도치 그림 + 한 줄 소개 + 시작하기. 본 뒤에는 html[data-seen] 으로 숨는다. */
export default function Intro() {
  return (
    <div className="intro-view">
      <main className="body">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="intro-img" src="/char/scene-b.webp" alt="" aria-hidden="true" />
        <h1 className="intro-h1">한 칸씩, 동네 배움으로</h1>
        <p className="sub gap-sub">
          집에서 시작해도 괜찮아요.
          <br />
          지금 나갈 수 있는 만큼만 골라 드릴게요.
        </p>
        <p className="note">로그인하지 않아도 볼 수 있어요</p>
      </main>
      <Button data-intro-start onClick={markIntroSeen}>
        시작하기
      </Button>
    </div>
  );
}
