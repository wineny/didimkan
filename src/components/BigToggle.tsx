"use client";

import { useSyncExternalStore } from "react";
import { setBig } from "@/lib/storage";

function subscribe(onChange: () => void) {
  const mo = new MutationObserver(onChange);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-big"] });
  return () => mo.disconnect();
}
const read = () => document.documentElement.hasAttribute("data-big");

export default function BigToggle() {
  const on = useSyncExternalStore(subscribe, read, () => false);

  function toggle() {
    const next = !on;
    if (next) document.documentElement.dataset.big = "1";
    else delete document.documentElement.dataset.big;
    setBig(next);
  }

  return (
    <button type="button" className="tbtn tbtn-big" data-big-toggle aria-pressed={on} onClick={toggle}>
      <span className="tbtn-ico" aria-hidden="true">가</span>
      <span>{on ? "보통 크기" : "크게보기"}</span>
    </button>
  );
}
