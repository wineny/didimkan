"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { M2_COPY } from "@/lib/copy";

const KEEP = ["st", "sido", "sigungu", "dong"] as const;

/** 파란 「관심 강좌로 접수 알림 받기」. 로그인돼 있으면 바로 등록하고, 아니면 로그인으로 보낸다. */
export default function NotifyButton({ courseId }: { courseId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onClick() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/alerts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ courseId }),
      });
      if (res.status === 401) {
        const here = new URLSearchParams(window.location.search);
        const q = new URLSearchParams({ course: courseId });
        for (const k of KEEP) q.set(k, here.get(k) ?? "");
        router.push(`/login?${q.toString()}`);
        return;
      }
      if (res.ok) {
        const data = (await res.json()) as { id?: string };
        if (data.id) {
          router.push(`/alert/${data.id}`);
          return;
        }
      }
      setError(res.status === 404 ? M2_COPY.login.errNoAlert : res.status === 409 ? M2_COPY.login.errAlertLimit : M2_COPY.login.errAlert);
    } catch {
      setError(M2_COPY.login.errNetwork);
    }
    setBusy(false);
  }

  return (
    <>
      <button type="button" className="cta c-notify" data-notify disabled={busy} onClick={onClick}>
        관심 강좌로 접수 알림 받기
      </button>
      {error ? (
        <p className="m-err" role="alert">
          {error}
        </p>
      ) : null}
    </>
  );
}
