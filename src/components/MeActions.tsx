"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { M2_COPY } from "@/lib/copy";
import BottomSheet from "./BottomSheet";

const C = M2_COPY.me;

/** 알림 카드 한 장의 「알림 끄기/켜기」 · 「빼기」 */
export function AlertControls({ id, isOn }: { id: string; isOn: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function call(init: RequestInit) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/alerts/${encodeURIComponent(id)}`, init);
      if (res.ok) {
        router.refresh();
        setBusy(false);
        return;
      }
    } catch {
      // 아래에서 같은 안내를 보여 준다
    }
    setError(C.errAction);
    setBusy(false);
  }

  return (
    <>
      <div className="m-btns">
        <button
          type="button"
          className="sbtn"
          data-alert-toggle
          disabled={busy}
          onClick={() =>
            call({ method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ isOn: !isOn }) })
          }
        >
          {isOn ? C.turnOff : C.turnOn}
        </button>
        <button type="button" className="sbtn" data-alert-remove disabled={busy} onClick={() => call({ method: "DELETE" })}>
          {C.remove}
        </button>
      </div>
      {error ? (
        <p className="m-err" role="alert">
          {error}
        </p>
      ) : null}
    </>
  );
}

/** 「내 번호 지우기」(확인 시트) 와 「로그아웃」 */
export default function MeActions({ maskedPhone }: { maskedPhone: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function leave(url: string, method: "POST" | "DELETE") {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(url, { method });
      if (res.ok) {
        router.push("/");
        router.refresh();
        return;
      }
    } catch {
      // 아래에서 같은 안내를 보여 준다
    }
    setError(C.errAction);
    setBusy(false);
  }

  return (
    <>
      <div className="m-danger">
        <button type="button" className="sbtn" data-delete-me onClick={() => setOpen(true)}>
          {C.deleteMe} · {maskedPhone}
        </button>
        <button type="button" className="lbtn m-skip" data-logout disabled={busy} onClick={() => leave("/api/auth/logout", "POST")}>
          {C.logout}
        </button>
        {error && !open ? (
          <p className="m-err" role="alert">
            {error}
          </p>
        ) : null}
      </div>
      <BottomSheet open={open} onClose={() => setOpen(false)} label={C.deleteMe}>
        <p className="c-sheet-t">{C.deleteTitle}</p>
        {error ? (
          <p className="m-err" role="alert">
            {error}
          </p>
        ) : null}
        <button type="button" className="cta c-sheet-btn" data-delete-confirm disabled={busy} onClick={() => leave("/api/me", "DELETE")}>
          {C.deleteConfirm}
        </button>
        <button type="button" className="sbtn c-sheet-btn" disabled={busy} onClick={() => setOpen(false)}>
          {C.close}
        </button>
      </BottomSheet>
    </>
  );
}
