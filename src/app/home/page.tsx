import Link from "next/link";
import CourseRow, { photoOf, toView } from "@/components/CourseRow";
import HeroCourse from "@/components/HeroCourse";
import Shell from "@/components/Shell";
import Stepper from "@/components/Stepper";
import { listCourses } from "@/db/queries";
import type { Stair } from "@/db/schema";
import { EMPTY_LIST, HOME_HINT, NEXT_SLOT_STAIR3 } from "@/lib/copy";
import { getToday } from "@/lib/today";
import "./home.css";

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;

export default async function HomePage({ searchParams }: PageProps<"/home">) {
  const sp = await searchParams;
  const n = Number(first(sp.st));
  const st: Stair = n === 1 || n === 3 ? n : 2;
  const area = { sido: first(sp.sido), sigungu: first(sp.sigungu), dong: first(sp.dong) };
  const today = getToday();

  const q = new URLSearchParams({ st: String(st) });
  for (const [k, v] of Object.entries(area)) if (v) q.set(k, v);
  const query = q.toString();

  const nowRows = await listCourses({ stair: st, area, today, limit: 6 });
  const nextRows = st < 3 ? await listCourses({ stair: (st + 1) as Stair, area, today, limit: 3 }) : [];
  const nowItems = nowRows.map((c) => toView(c, query));
  const nextItems = nextRows.map((c) => toView(c, query));

  const hero = nowItems[0];
  const rest = nowItems.slice(1);
  const nextAlt = !!hero && !!nextItems[0] && hero.category === "어학" && nextItems[0].category === "어학";

  return (
    <Shell>
      <main className="body home">
        {hero ? <HeroCourse v={hero} /> : null}

        <h2 className="h2 home-h2">지금 칸과 다음 칸</h2>
        <Stepper st={st} nowItems={nowItems} nextItems={nextItems} />

        <div className="home-list">
          {nowItems.length === 0 ? (
            <>
              <p className="home-empty">{EMPTY_LIST}</p>
              <Link href={`/where?st=${st}`} className="sbtn home-where">
                동네 바꾸기
              </Link>
            </>
          ) : (
            rest.length > 0 && (
              <section className="home-sec">
                <div className="home-lab">지금 칸</div>
                {st !== 3 && <p className="home-hint">{HOME_HINT[st]}</p>}
                {rest.map((v) => (
                  <CourseRow key={v.id} v={v} />
                ))}
              </section>
            )
          )}

          <section className="home-sec home-next">
            <div className="home-lab">다음 칸</div>
            {st === 3 ? (
              <p className="home-hint">{NEXT_SLOT_STAIR3}</p>
            ) : nextItems.length === 0 ? (
              <p className="home-hint">{EMPTY_LIST}</p>
            ) : (
              nextItems.map((v, i) => (
                <CourseRow key={v.id} v={v} thumb={{ src: photoOf(v.category, i === 0 && nextAlt) }} />
              ))
            )}
          </section>
        </div>
      </main>
    </Shell>
  );
}
