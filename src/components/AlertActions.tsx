"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { M2_COPY } from "@/lib/copy";

const C = M2_COPY.alert;

/** 06 아래쪽 버튼. 강좌가 사라졌으면 「빼기」만, 아니면 「이대로 알려주세요」. */
export default function AlertActions({ alertId, gone }: { alertId: string; gone: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/alerts/${encodeURIComponent(alertId)}`, { method: "DELETE" });
      if (res.ok) {
        router.push("/me");
        router.refresh();
        return;
      }
    } catch {
      // 아래에서 같은 안내를 보여 준다
    }
    setError(M2_COPY.me.errAction);
    setBusy(false);
  }

  return (
    <div className="m-acts">
      {error ? (
        <p className="m-err" role="alert">
          {error}
        </p>
      ) : null}
      {gone ? (
        <>
          <button type="button" className="cta" data-alert-remove disabled={busy} onClick={remove}>
            {C.remove}
          </button>
          <Link className="sbtn" href="/">
            {C.browse}
          </Link>
        </>
      ) : (
        <button type="button" className="cta" data-done onClick={() => router.push("/me")}>
          {C.done}
        </button>
      )}
    </div>
  );
}
