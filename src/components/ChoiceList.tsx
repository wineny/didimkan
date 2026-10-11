export type Choice = { value: string; title: string; sub?: string; /** 카드 왼쪽 화분 그림(1 씨앗 · 2 새싹 · 3 꽃, 장식) */ stair?: 1 | 2 | 3 };

const POT = { 1: "seed", 2: "sprout", 3: "flower" } as const;

/** 종이 카드 선택지: (화분 그림) + 굵은 한 줄 + 회색 한 줄 + 동그라미. dataAttr 로 e2e 셀렉터 속성 이름을 정한다. */
export default function ChoiceList({
  items,
  selected,
  onSelect,
  dataAttr,
  label,
}: {
  items: Choice[];
  selected: string;
  onSelect: (value: string) => void;
  dataAttr: string;
  label: string;
}) {
  return (
    <div className="opts" role="group" aria-label={label}>
      {items.map((it) => {
        const on = it.value === selected;
        return (
          <button
            key={it.value}
            type="button"
            className="opt"
            aria-pressed={on}
            {...{ [dataAttr]: it.value }}
            onClick={() => onSelect(it.value)}
          >
            {it.stair ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="opt-pot" src={`/char/i-pot-${POT[it.stair]}.webp`} alt="" aria-hidden="true" />
            ) : null}
            <span className="opt-tx">
              <span className="o1">{it.title}</span>
              {it.sub && <span className="o2">{it.sub}</span>}
            </span>
            <span className={on ? "radio on" : "radio"} aria-hidden="true" />
          </button>
        );
      })}
    </div>
  );
}
