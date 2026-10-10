export type InfoCell = { k: string; v: string; d?: string | null; tile?: string; tone?: string };

/** 6칸 정보 (A2): 2열 격자 3행. 칸마다 번호 · 라벨 · 값(숲색) · 설명. data-tile 을 단다. 크게 보기에서는 세로 1열. */
export default function InfoGrid({ cells }: { cells: InfoCell[] }) {
  return (
    <dl className="c-data">
      {cells.map((c, i) => (
        <div className={`c-cell${c.tone ? ` ${c.tone}` : ""}`} key={c.k} data-tile={c.tile}>
          <dt>
            <span>{String(i + 1).padStart(2, "0")}</span>
            {c.k}
          </dt>
          <dd className="v">{c.v}</dd>
          <dd className="d">{c.d || "확인 안 됨"}</dd>
        </div>
      ))}
    </dl>
  );
}
