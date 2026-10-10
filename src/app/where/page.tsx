import Shell from "@/components/Shell";
import WherePicker from "@/components/WherePicker";
import { listAreas, type AreaTree } from "@/db/queries";
import type { Stair } from "@/db/schema";

/** DB 를 못 읽을 때 쓰는 예시 지역 (셀렉터 계약 예시) */
const FALLBACK: AreaTree = {
  sido: [
    {
      name: "서울특별시",
      sigungu: [{ name: "강남구", dong: ["일원동", "논현동", "수서동", "개포동"] }],
    },
  ],
};

async function loadAreas(): Promise<AreaTree> {
  try {
    const tree = await listAreas();
    return tree.sido.length > 0 ? tree : FALLBACK;
  } catch {
    return FALLBACK;
  }
}

export default async function WherePage({ searchParams }: PageProps<"/where">) {
  const sp = await searchParams;
  const st = Number(Array.isArray(sp.st) ? sp.st[0] : sp.st);
  const stair: Stair = st === 1 || st === 3 ? st : 2;
  const tree = await loadAreas();
  return (
    <Shell dev={sp.dev === "1"}>
      <WherePicker tree={tree} stair={stair} />
    </Shell>
  );
}
