"use client";

import Link from "next/link";
import { useEffect, useRef, useSyncExternalStore, type PointerEvent } from "react";
import { M2_COPY } from "@/lib/copy";

const C = M2_COPY.intro;
const N = C.slides.length;
const PAGE_EVENT = "didim:intro-page";
const SWIPE_PX = 40;

// 지금 장은 주소 끝 해시(#3)에 둔다. 링크로 특정 장을 바로 열 수 있고 새로고침해도 그 장에 머문다.
function subscribe(onChange: () => void) {
  window.addEventListener("hashchange", onChange);
  window.addEventListener(PAGE_EVENT, onChange);
  return () => {
    window.removeEventListener("hashchange", onChange);
    window.removeEventListener(PAGE_EVENT, onChange);
  };
}
function readPage() {
  const n = Number(window.location.hash.slice(1));
  return Number.isInteger(n) && n >= 1 && n <= N ? n : 1;
}
// replaceState 라 넘길 때마다 방문 기록이 쌓이지 않는다(뒤로 가기는 이전 사이트로).
function setPage(n: number) {
  const p = Math.min(N, Math.max(1, n));
  if (p === readPage()) return;
  history.replaceState(null, "", `#${p}`);
  window.dispatchEvent(new Event(PAGE_EVENT));
}

/** 소개 자료 7장을 좌우로 넘긴다: 이전·다음 버튼, 점, ← → 키, 밀기. */
export default function IntroDeck() {
  const page = useSyncExternalStore(subscribe, readPage, () => 1);
  const deck = useRef<HTMLDivElement>(null);
  const start = useRef<{ x: number; y: number } | null>(null);

  // 첫 화면(해시로 연 장 포함)은 미끄러지지 않고, 사람이 넘길 때부터 움직임을 켠다.
  function go(n: number) {
    deck.current?.setAttribute("data-anim", "");
    setPage(n);
  }

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      const k = e.key;
      const d = k === "ArrowRight" || k === "PageDown" ? 1 : k === "ArrowLeft" || k === "PageUp" ? -1 : 0;
      if (d !== 0) {
        e.preventDefault();
        deck.current?.setAttribute("data-anim", "");
        setPage(readPage() + d);
      } else if (k === "Home" || k === "End") {
        e.preventDefault();
        deck.current?.setAttribute("data-anim", "");
        setPage(k === "Home" ? 1 : N);
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  function handlePointerDown(e: PointerEvent) {
    start.current = { x: e.clientX, y: e.clientY };
  }
  function handlePointerUp(e: PointerEvent) {
    const s = start.current;
    start.current = null;
    if (!s) return;
    const dx = e.clientX - s.x;
    if (Math.abs(dx) >= SWIPE_PX && Math.abs(dx) > Math.abs(e.clientY - s.y)) go(page + (dx < 0 ? 1 : -1));
  }

  return (
    <div className="deck" ref={deck}>
      <header className="deck-top">
        <Link className="deck-logo" href="/" aria-label={C.home}>
          디딤칸<i>.</i>
        </Link>
        <span className="deck-label">{C.label}</span>
        <nav className="deck-links">
          <Link href="/about">{C.about}</Link>
          <Link href="/">{C.home}</Link>
        </nav>
      </header>

      <main className="deck-view" aria-roledescription="carousel" aria-label={C.title}>
        <div className="deck-fit">
        <div
          className="deck-frame"
          onPointerDown={handlePointerDown}
          onPointerUp={handlePointerUp}
          onPointerCancel={() => {
            start.current = null;
          }}
        >
          <div className="deck-track" style={{ transform: `translateX(${-(page - 1) * 100}%)` }}>
            {C.slides.map((alt, i) => (
              <figure
                className="deck-slide"
                key={i}
                aria-roledescription="slide"
                aria-label={`${i + 1} / ${N}`}
                aria-hidden={i + 1 !== page}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/intro/${i + 1}.webp`} alt={alt} width={1920} height={1080} draggable={false} />
              </figure>
            ))}
          </div>
        </div>
        </div>
        <p className="deck-turn">{C.turn}</p>
      </main>

      <footer className="deck-bar">
        <button type="button" className="deck-btn" onClick={() => go(page - 1)} disabled={page === 1}>
          <span aria-hidden="true">←</span> {C.prev}
        </button>
        <div className="deck-mid">
          <div className="deck-dots">
            {C.slides.map((_, i) => (
              <button
                type="button"
                key={i}
                className="deck-dot"
                aria-label={`${i + 1}${C.goTo}`}
                aria-current={i + 1 === page ? "true" : undefined}
                onClick={() => go(i + 1)}
              />
            ))}
          </div>
          <span className="deck-count" aria-live="polite">
            {page} / {N}
          </span>
        </div>
        <button type="button" className="deck-btn" onClick={() => go(page + 1)} disabled={page === N}>
          {C.next} <span aria-hidden="true">→</span>
        </button>
      </footer>
    </div>
  );
}
