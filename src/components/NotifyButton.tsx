"use client";

import { useState } from "react";
import { NOTIFY_SHEET } from "@/lib/copy";
import { safeHttpUrl } from "@/lib/url";
import BottomSheet from "./BottomSheet";

/** 파란 「관심 강좌로 접수 알림 받기」. 누르면 11월에 열린다는 시트가 올라온다. */
export default function NotifyButton({
  phone,
  siteUrl,
}: {
  phone: string | null;
  siteUrl: string | null;
}) {
  const [open, setOpen] = useState(false);
  const site = safeHttpUrl(siteUrl);
  return (
    <>
      <button type="button" className="cta c-notify" data-notify onClick={() => setOpen(true)}>
        관심 강좌로 접수 알림 받기
      </button>
      <BottomSheet open={open} onClose={() => setOpen(false)} label="접수 알림 안내">
        <p className="c-sheet-t">{NOTIFY_SHEET}</p>
        {phone ? (
          <a className="cta c-sheet-btn" href={`tel:${phone.replace(/[^\d+]/g, "")}`}>
            전화하기 · {phone}
          </a>
        ) : null}
        {site ? (
          <a className="sbtn c-sheet-btn" href={site} target="_blank" rel="noopener noreferrer">
            기관 사이트 열기
          </a>
        ) : null}
        <button type="button" className="sbtn c-sheet-btn" onClick={() => setOpen(false)}>
          닫기
        </button>
      </BottomSheet>
    </>
  );
}
