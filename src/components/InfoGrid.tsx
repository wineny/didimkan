import type { ReactNode } from "react";

export type InfoCell = { k: string; v: string; d?: string | null; tile?: string; tone?: string };

/** 2칸 격자 표 (v4 .info + .grid + .cell). 칸마다 data-tile 을 달 수 있고, footer 는 카드 맨 아래 줄. 크게 보기에서는 세로 1열. */
export default function InfoGrid({ cells, footer }: { cells: InfoCell[]; footer?: ReactNode }) {
  return (
    <div className="info c-info">
      <div className="grid">
        {cells.map((c) => (
          <div className={`cell${c.tone ? ` ${c.tone}` : ""}`} key={c.k} data-tile={c.tile}>
            <div className="k">{c.k}</div>
            <div className="v">{c.v}</div>
            <div className="d">{c.d || "확인 안 됨"}</div>
          </div>
        ))}
      </div>
      {footer}
    </div>
  );
}
