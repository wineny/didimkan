export type Choice = { value: string; title: string; sub?: string };

/** 동그라미 + 굵은 한 줄 + 회색 한 줄 (GOV.UK 식). dataAttr 로 e2e 셀렉터 속성 이름을 정한다. */
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
            <span className={on ? "radio on" : "radio"} aria-hidden="true" />
            <span>
              <span className="o1">{it.title}</span>
              {it.sub && <span className="o2">{it.sub}</span>}
            </span>
          </button>
        );
      })}
    </div>
  );
}
