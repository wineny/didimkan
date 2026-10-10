import Link from "next/link";
import Shell from "@/components/Shell";
import { M2_COPY } from "@/lib/copy";

const C = M2_COPY.privacy;

export default function PrivacyPage() {
  return (
    <Shell>
      <main className="m-main m-priv" aria-label={C.h1}>
        <div className="body">
          <h1 className="h1 gap-8">
            {C.h1}
            <span className="m-draft">{C.draft}</span>
          </h1>
          <p className="sub">{C.sub}</p>
          <div className="gap-24" style={{ borderTop: "1px solid var(--line)" }}>
            {C.rows.map((r) => (
              <div className="kv" key={r.k}>
                <div className="k">{r.k}</div>
                <div className="v">{r.v}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="m-acts">
          <Link className="sbtn" href="/">
            {C.back}
          </Link>
        </div>
      </main>
    </Shell>
  );
}
