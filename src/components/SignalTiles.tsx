import type { Tile } from "@/lib/copy";

/** 문턱 신호 타일 6개 (2열). tone 으로 면 색을 달리한다. */
export default function SignalTiles({ tiles }: { tiles: Tile[] }) {
  return (
    <div className="c-tiles">
      {tiles.map((t) => (
        <div key={t.key} className={`c-tile ${t.tone}`} data-tile={t.key}>
          <div className="k">{t.label}</div>
          <div className="v">{t.value}</div>
        </div>
      ))}
    </div>
  );
}
