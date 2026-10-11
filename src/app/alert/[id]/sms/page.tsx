import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { applyWhen, slotMark } from "@/components/alertText";
import EmptyNote from "@/components/EmptyNote";
import Shell from "@/components/Shell";
import { getMyAlert } from "@/db/alerts";
import { getSession } from "@/lib/auth";
import { M2_COPY, orgName } from "@/lib/copy";
import { koreanClock, koreanDate, schedule, smsText } from "@/lib/notify";
import { getNow } from "@/lib/today";
import { safeHttpUrl } from "@/lib/url";

const C = M2_COPY.sms;

export default async function AlertSmsPage({ params }: PageProps<"/alert/[id]/sms">) {
  const { id } = await params;
  const session = await getSession();
  if (!session) redirect(`/login?next=${encodeURIComponent(`/alert/${id}/sms`)}`);
  const a = await getMyAlert(session.userId, id);
  if (!a) notFound();

  const course = a.course;
  const back = `/alert/${a.id}`;
  const header = (
    <div className="m-smsbar">
      <Link href={back} aria-label={C.back} className="m-smsback">
        <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </Link>
      <span className="ava" aria-hidden="true">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/char/h-face.webp" alt="" />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="t">{C.title}</div>
        <div className="meta">{C.sub}</div>
      </div>
    </div>
  );

  if (!course || !a.applyDate) {
    return (
      <Shell>
        {header}
        <main className="m-main" aria-label={C.title}>
          <div className="body">
            <EmptyNote className="sub">{C.empty}</EmptyNote>
          </div>
          <div className="m-acts">
            <Link className="sbtn" href={back}>
              {C.back}
            </Link>
          </div>
        </main>
      </Shell>
    );
  }

  const now = getNow();
  const sched = schedule(a.applyDate);
  const siteUrl = safeHttpUrl(course.detailUrl) ?? safeHttpUrl(course.homepageUrl);
  const text = (kind: "d3" | "d0") =>
    smsText(kind, {
      title: course.title,
      applyDate: a.applyDate!,
      isEstimate: a.isEstimate,
      source: course.source,
      orgName: orgName(course),
      siteUrl,
      phone: course.phone,
      capacity: course.capacity,
      selectionMethod: course.selectionMethod,
    });
  const items = (["d3", "d0"] as const).map((kind) => {
    const s = sched[kind];
    const state = slotMark(kind, a.applyDate!, now, a.sent);
    const mark = state === "sent" ? M2_COPY.alert.sent : state === "passed" ? M2_COPY.alert.passed : null;
    const label = `${koreanDate(s.date)} ${koreanClock(s.hour)} · ${kind === "d3" ? C.d3 : C.d0}${mark ? ` · ${mark}` : ""}`;
    return { kind, label, body: text(kind) };
  });

  return (
    <Shell>
      {header}
      <main className="m-main" aria-label={C.title}>
        <div className="body m-smsbody">
          <p className="meta" style={{ margin: "0.5882rem 0 0" }}>
            {applyWhen(a.applyDate, course.source)}
            {a.isEstimate ? ` · ${M2_COPY.alert.applyEstimate}` : ""}
          </p>
          {items.map((it) => (
            <div key={it.kind} style={{ display: "flex", flexDirection: "column", gap: "0.3529rem" }}>
              <div className="when" data-sms-when={it.kind}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/char/i-letter.webp" alt="" aria-hidden="true" />
                {it.label}
              </div>
              <div className="bub" data-sms={it.kind}>
                {it.body}
              </div>
            </div>
          ))}
        </div>
        <p className="m-closing">{C.closing}</p>
      </main>
    </Shell>
  );
}
