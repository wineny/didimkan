import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import AlertActions from "@/components/AlertActions";
import { applyWhen, slotMark } from "@/components/alertText";
import Shell from "@/components/Shell";
import { getMyAlert } from "@/db/alerts";
import { getSession } from "@/lib/auth";
import { M2_COPY, orgName } from "@/lib/copy";
import { koreanClock, koreanDate, schedule } from "@/lib/notify";
import { maskPhone } from "@/lib/phone";
import { getNow } from "@/lib/today";

const C = M2_COPY.alert;

export default async function AlertPage({ params }: PageProps<"/alert/[id]">) {
  const { id } = await params;
  const session = await getSession();
  if (!session) redirect(`/login?next=${encodeURIComponent(`/alert/${id}`)}`);
  const a = await getMyAlert(session.userId, id);
  if (!a) notFound();

  const now = getNow();
  const course = a.course;
  const when = a.applyDate && course ? applyWhen(a.applyDate, course.source) : null;
  const slots = a.applyDate
    ? (["d3", "d0"] as const).map((kind) => {
        const s = schedule(a.applyDate!)[kind];
        const state = slotMark(kind, a.applyDate!, now, a.sent);
        const mark = state === "sent" ? C.sent : state === "passed" ? C.passed : null;
        return { kind, label: kind === "d3" ? C.d3 : C.d0, text: `${koreanDate(s.date)} ${koreanClock(s.hour)}`, mark };
      })
    : [];
  const where = course ? [orgName(course), course.phone].filter(Boolean).join(" · ") : null;

  return (
    <Shell>
      <main className="m-main" aria-label={C.h1}>
        <div className="body">
          <h1 className="h1 gap-8">{C.h1}</h1>
          <p className="sub">{C.sub}</p>

          {course ? (
            <>
              <div className="info gap-24" style={{ paddingBottom: "0.2353rem" }}>
                <div className="sec" style={{ marginTop: "0.7059rem" }}>
                  {course.title} {a.applyDate ? (a.isEstimate ? C.applyEstimate : C.applyConfirmed) : C.applyUnknown}
                </div>
                {when ? <div className="m-big">{when}</div> : null}
                <div style={{ marginTop: "0.5882rem", borderTop: "1px solid var(--line)" }}>
                  {slots.length > 0 ? (
                    slots.map((s) => (
                      <div className="kv" key={s.kind} data-slot={s.kind}>
                        <div className="k">{s.label}</div>
                        <div className="v">
                          {s.text}
                          {s.mark ? <span className="s">{s.mark}</span> : null}
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="meta" style={{ margin: "0.7059rem 0" }}>
                      {C.noSchedule}
                    </p>
                  )}
                </div>
              </div>

              {where ? (
                <div className="kv">
                  <div className="k">{C.where}</div>
                  <div className="v">{where}</div>
                </div>
              ) : null}
            </>
          ) : (
            <p className="m-err" role="alert">
              {C.gone}
            </p>
          )}

          <div className="kv">
            <div className="k">{C.to}</div>
            <div className="v">
              {C.me} <span className="s">{maskPhone(session.phone)}</span>
            </div>
          </div>
          <div className="kv">
            <div className="k">{C.addMore}</div>
            <div className="v soft">{C.soon}</div>
          </div>

          {course && a.applyDate ? (
            <Link className="sbtn gap-24" data-sms-preview href={`/alert/${a.id}/sms`}>
              {C.preview}
            </Link>
          ) : null}
        </div>
        <AlertActions alertId={a.id} gone={!course} />
      </main>
    </Shell>
  );
}
