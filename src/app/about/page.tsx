import type { Metadata } from "next";
import Link from "next/link";
import Shell from "@/components/Shell";
import { M2_COPY } from "@/lib/copy";

const C = M2_COPY.about;

const MAILTO = `mailto:${C.contact.mail}?subject=${encodeURIComponent(C.mailSubject)}`;

// openGraph 는 layout 과 합쳐지지 않고 통째로 바뀌므로 siteName·locale·type 을 다시 적는다. 그림은 루트 opengraph-image.png.
export const metadata: Metadata = {
  title: "디딤칸 기관 안내",
  description: C.sub,
  openGraph: {
    title: "디딤칸 기관 안내",
    description: C.sub,
    siteName: "디딤칸",
    locale: "ko_KR",
    type: "website",
    images: [{ url: "/opengraph-image.png", width: 1200, height: 630 }],
  },
};

/** 기관 담당자용 소개: 왜 → 무엇 → 함께하고 싶은 것 → 연락. 소개 이미지 v3 의 01·03·06 장을 한 화면에. */
export default function AboutPage() {
  return (
    <Shell>
      <main className="m-main m-about" aria-label={C.h1}>
        <div className="body">
          <div className="m-hello">
            <div className="m-hello-tx">
              <h1 className="h1">{C.h1}</h1>
              <p className="sub">{C.sub}</p>
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="m-hello-img" src="/char/h-guide.webp" alt="" aria-hidden="true" />
          </div>

          <h2 className="sec gap-24">{C.why.sec}</h2>
          <p className="lead">{C.why.lead}</p>
          <div className="p-card gap-8">
            {C.why.rows.map((r) => (
              <div className="kv" key={r.k}>
                <div className="k">{r.k}</div>
                <div className="v">
                  {r.v}
                  <span className="s">{r.s}</span>
                </div>
              </div>
            ))}
          </div>
          <p className="lead">{C.why.tail}</p>

          <h2 className="sec gap-24">{C.what.sec}</h2>
          <p className="lead">{C.what.lead}</p>
          <div className="p-card gap-8">
            {C.what.stairs.map((r) => (
              <div className="kv" key={r.k}>
                <div className="k">{r.k}</div>
                <div className="v">
                  {r.v}
                  {"s" in r ? <span className="s">{r.s}</span> : null}
                </div>
              </div>
            ))}
            <div className="kv">
              <div className="k">{C.what.aiSec}</div>
              <ul className="ai">
                {C.what.ai.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
              <p className="meta">{C.what.aiNote}</p>
            </div>
          </div>
          <p className="flow">{C.what.flow}</p>

          <h2 className="sec gap-24">{C.together.sec}</h2>
          <div className="p-card gap-8">
            {C.together.rows.map((r) => (
              <div className="kv" key={r.k}>
                <div className="k">{r.k}</div>
                <div className="v txt">{r.v}</div>
              </div>
            ))}
            <div className="kv">
              <div className="k">{C.together.giveK}</div>
              <div className="v txt">{C.together.giveV}</div>
            </div>
          </div>

          <h2 className="sec gap-24">{C.contact.sec}</h2>
          <div className="p-card gap-8">
            <div className="kv">
              <div className="k">{C.contact.nameK}</div>
              <div className="v txt">{C.contact.nameV}</div>
            </div>
            <div className="kv">
              <div className="k">{C.contact.mailK}</div>
              <div className="v txt">
                <a href={MAILTO}>{C.contact.mail}</a>
              </div>
            </div>
            <div className="kv">
              <div className="k">{C.contact.noteK}</div>
              <div className="v txt">{C.contact.noteV}</div>
            </div>
          </div>
        </div>
        <div className="m-acts">
          <a className="cta" href={MAILTO}>
            {C.mailBtn}
          </a>
          <Link className="sbtn" href="/">
            {C.back}
          </Link>
        </div>
      </main>
    </Shell>
  );
}
