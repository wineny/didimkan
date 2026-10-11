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
  // 신청하는 곳: 기관명 · 전화(전화번호는 한 줄에서 끊기지 않게 따로 감싼다)
  const where = course && (orgName(course) || course.phone) ? { org: orgName(course), phone: course.phone } : null;

  return (
    <Shell foot="실제 접수는 기관에 확인하세요 · 그림은 AI 생성 시범 이미지">
      <main className="m-main" aria-label={C.h1}>
        <div className="body">
          <div className="m-hello">
            <div className="m-hello-tx">
              <h1 className="h1">{C.h1}</h1>
              <p className="sub">{C.sub}</p>
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="m-hello-img" src="/char/h-joy.webp" alt="" aria-hidden="true" />
          </div>

          {course ? (
            <div className="m-hero gap-24">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="m-hero-bell" src="/char/i-bell.webp" alt="" aria-hidden="true" />
              <div className="m-hero-t">
                {course.title}{" "}
                <span className="m-hero-chip">{a.applyDate ? (a.isEstimate ? C.applyEstimate : C.applyConfirmed) : C.applyUnknown}</span>
              </div>
              {when ? <div className="m-big">{when}</div> : null}
              <div className="m-hero-rows">
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
          ) : (
            <p className="m-err" role="alert">
              {C.gone}
            </p>
          )}

          <div className="p-card gap-12">
            {course && where ? (
              <div className="kv">
                <div className="k">{C.where}</div>
                <div className="v">
                  {where.org}
                  {where.org && where.phone ? " · " : null}
                  {where.phone ? <span className="m-nw">{where.phone}</span> : null}
                </div>
              </div>
            ) : null}
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
