import Link from "next/link";
import { redirect } from "next/navigation";
import { applyWhen } from "@/components/alertText";
import { AlertControls } from "@/components/MeActions";
import MeActions from "@/components/MeActions";
import Shell from "@/components/Shell";
import { listMyAlerts } from "@/db/alerts";
import { getSession } from "@/lib/auth";
import { M2_COPY, orgName } from "@/lib/copy";
import { koreanClock, koreanDate, remaining } from "@/lib/notify";
import { maskPhone } from "@/lib/phone";
import { getNow } from "@/lib/today";

const C = M2_COPY.me;

export default async function MePage() {
  const session = await getSession();
  if (!session) redirect("/login?next=%2Fme");
  const alerts = await listMyAlerts(session.userId);
  const now = getNow();

  return (
    <Shell>
      <main className="m-main" aria-label={C.h1}>
        <div className="body">
          <h1 className="h1 gap-8">{C.h1}</h1>
          <p className="sub">{C.sub}</p>

          <div className="sec gap-24">
            {C.listLabel} · {alerts.length}개
          </div>
          {alerts.length === 0 ? <p className="m-empty">{C.empty}</p> : null}
          {alerts.map((a) => {
            const course = a.course;
            const line = course
              ? a.applyDate
                ? `${orgName(course)} · ${applyWhen(a.applyDate, course.source)} 접수${a.isEstimate ? " · 예상이며 확정 아님" : ""}`
                : `${orgName(course)} · 접수일 확인 안 됨`
              : null;
            const left = a.applyDate ? remaining(a.applyDate, now, new Set(a.sent)) : null;
            const next = a.next ? `${koreanDate(a.next.date)} ${koreanClock(a.next.hour)}` : C.noNext;
            return (
              <article
                key={a.id}
                className={`info m-card${a.isOn ? "" : " is-off"}`}
                data-alert
                data-alert-id={a.id}
                data-on={a.isOn ? "true" : "false"}
              >
                <div className="m-ct">
                  {course ? course.title : C.gone}
                  {a.isOn ? null : <span className="m-off">{C.off}</span>}
                </div>
                {line ? <div className="meta">{line}</div> : null}
                {course ? (
                  <div style={{ marginTop: "0.5882rem", borderTop: "1px solid var(--line)" }}>
                    <div className="kv">
                      <div className="k">{C.nextSms}</div>
                      <div className="v">{a.isOn ? next : C.offNext}</div>
                    </div>
                    <div className="kv">
                      <div className="k">{C.left}</div>
                      <div className="v">
                        {left ? (
                          <>
                            <span className="m-dots" aria-hidden="true">
                              {Array.from({ length: left.total }, (_, i) => (
                                <i key={i} className={i < left.left ? "on" : ""} />
                              ))}
                            </span>
                            {left.total}번 중 {left.left}번
                          </>
                        ) : (
                          <span className="soft">{C.noNext}</span>
                        )}
                      </div>
                    </div>
                  </div>
                ) : null}
                <AlertControls id={a.id} isOn={a.isOn} />
              </article>
            );
          })}

          <div className="kv gap-24">
            <div className="k">{C.together}</div>
            <div className="v soft">{C.soon}</div>
          </div>

          <MeActions maskedPhone={maskPhone(session.phone)} />
        </div>
        <div className="m-acts">
          <Link className="cta" href="/">
            {C.browse}
          </Link>
        </div>
      </main>
    </Shell>
  );
}
