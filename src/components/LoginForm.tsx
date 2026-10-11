"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { M2_COPY } from "@/lib/copy";
import { safeNext } from "@/lib/url";

const C = M2_COPY.login;
const RESEND_SEC = 30;

export type LoginCourse = { id: string; title: string; line: string };

/** 입력 중 하이픈 자동 (표시용). 서버에는 숫자만 보낸다. */
function formatDigits(digits: string): string {
  const d = digits.slice(0, 11);
  if (d.length <= 3) return d;
  if (d.length <= 7) return `${d.slice(0, 3)}-${d.slice(3)}`;
  if (d.length <= 10) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
  return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
}

const VERIFY_ERR: Record<string, string> = {
  wrong: C.errWrong,
  expired: C.errExpired,
  locked: C.errLocked,
  invalid: C.errCode,
};

async function postJson(url: string, body: unknown): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export default function LoginForm({
  course,
  skipHref,
  next,
  loggedIn,
}: {
  course: LoginCourse | null;
  /** 「로그인하지 않고 계속 둘러보기」가 가는 곳 */
  skipHref: string;
  next: string | null;
  /** 이미 로그인한 사람이 강좌를 들고 왔을 때: 번호 입력 없이 등록만 한다 */
  loggedIn: boolean;
}) {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2>(1);
  const [digits, setDigits] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cool, setCool] = useState(0);
  /** 인증은 됐는데 알림 등록이 실패한 상태(다시 「확인」을 눌러도 소용없다) */
  const [verified, setVerified] = useState(false);
  const codeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (step === 2) codeRef.current?.focus();
  }, [step]);

  useEffect(() => {
    if (cool <= 0) return;
    const t = setTimeout(() => setCool((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [cool]);

  /** 로그인된 상태에서 강좌 알림을 만들고 06 으로, 강좌가 없으면 next 로. */
  async function finish(): Promise<void> {
    if (!course) {
      router.push(safeNext(next, window.location.origin));
      return;
    }
    try {
      const res = await postJson("/api/alerts", { courseId: course.id });
      if (res.ok) {
        const data = (await res.json()) as { id?: string };
        if (data.id) {
          router.push(`/alert/${data.id}`);
          return;
        }
      }
      setError(res.status === 404 ? C.errNoAlert : res.status === 409 ? C.errAlertLimit : C.errAlert);
    } catch {
      setError(C.errNetwork);
    }
    setBusy(false);
  }

  async function sendCode(): Promise<void> {
    if (digits.length < 10) {
      setError(C.errInvalidPhone);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await postJson("/api/auth/send-code", { phone: digits });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; reason?: string };
      if (res.ok && data.ok) {
        setStep(2);
        setCode("");
        setCool(RESEND_SEC);
      } else if (res.status === 429 || data.reason === "rate") {
        setError(C.errRate);
      } else if (data.reason === "failed") {
        setError(C.errSendFailed);
      } else if (res.status === 503 || data.reason === "unavailable") {
        setError(C.errUnavailable);
      } else {
        setError(C.errInvalidPhone);
      }
    } catch {
      setError(C.errNetwork);
    }
    setBusy(false);
  }

  async function verify(): Promise<void> {
    if (code.length !== 6) {
      setError(C.errCode);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await postJson("/api/auth/verify", { phone: digits, code });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; reason?: string };
      if (res.ok && data.ok) {
        setVerified(true);
        await finish();
        return;
      }
      setError(VERIFY_ERR[data.reason ?? ""] ?? C.errWrong);
    } catch {
      setError(C.errNetwork);
    }
    setBusy(false);
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (step === 1) void sendCode();
    else void verify();
  }

  if (loggedIn && course) {
    // 링크만 열어도 등록되지 않게, 버튼을 한 번 누르게 한다.
    return (
      <div className="m-form">
        <div className="body">
          <div className="m-hello">
            <h1 className="h1 gap-h1">{C.confirmH1}</h1>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="m-hello-img" src="/char/h-bell.webp" alt="" aria-hidden="true" />
          </div>
          <div className="p-card m-pick gap-24">
            <p className="m-courseline" role="status">
              {course.title}
            </p>
            <p className="meta m-pick-line">{course.line}</p>
          </div>
          {error ? (
            <p className="m-err" role="alert">
              {error}
            </p>
          ) : null}
        </div>
        <div className="m-acts">
          <button
            type="button"
            className="cta"
            data-notify-confirm
            disabled={busy}
            onClick={() => {
              setBusy(true);
              setError(null);
              void finish();
            }}
          >
            {busy ? C.registering : C.confirmBtn}
          </button>
          <Link className="lbtn m-skip" href={skipHref}>
            {C.skip}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <form className="m-form" onSubmit={onSubmit} noValidate>
      <div className="body">
        <div className="m-hello">
          <div className="m-hello-tx">
            <p className="m-kick">{step === 1 ? C.kick1 : C.kick2}</p>
            <h1 className="h1 gap-8">{C.h1}</h1>
          </div>
          {/* 1단계 수줍은 고슴도치, 2단계 편지(문자) 받는 고슴도치 */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="m-hello-img" src={step === 1 ? "/char/h-shy.webp" : "/char/h-letter.webp"} alt="" aria-hidden="true" />
        </div>
        <p className="sub">{C.sub}</p>

        {course ? (
          <div className="p-card m-pick gap-24">
            <div className="sec">{C.courseLabel}</div>
            <div className="m-courseline">{course.title}</div>
            <div className="meta m-pick-line">{course.line}</div>
          </div>
        ) : null}

        {step === 1 ? (
          <>
            <label className="sec gap-24" htmlFor="login-phone" style={{ display: "block" }}>
              {C.phoneLabel}
            </label>
            <div className="gap-8">
              <input
                id="login-phone"
                className="field"
                type="tel"
                inputMode="numeric"
                autoComplete="tel"
                data-phone
                placeholder={C.phonePlaceholder}
                value={formatDigits(digits)}
                onChange={(e) => setDigits(e.target.value.replace(/\D/g, "").slice(0, 11))}
              />
            </div>
            <p className="meta gap-8">
              {C.note}{" "}
              <Link href="/privacy" className="link">
                {C.privacyLink}
              </Link>
            </p>
          </>
        ) : (
          <>
            <div className="m-row m-sent gap-24">
              <span>
                {formatDigits(digits)} {C.sentSuffix}
              </span>
              <button
                type="button"
                className="lbtn"
                disabled={busy}
                onClick={() => {
                  setStep(1);
                  setError(null);
                }}
              >
                {C.changePhone}
              </button>
            </div>
            <label className="sec gap-24" htmlFor="login-code" style={{ display: "block" }}>
              {C.codeLabel}
            </label>
            <div className="gap-8">
              <input
                id="login-code"
                className="field otp-in"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                data-code
                ref={codeRef}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              />
            </div>
            <div className="m-row m-resend">
              <span>{C.resendHint}</span>
              <button type="button" className="lbtn" data-resend disabled={busy || cool > 0} onClick={() => void sendCode()}>
                {C.resend}
              </button>
            </div>
            {cool > 0 ? (
              <p className="meta m-cool">
                {cool}
                {C.resendWaitSuffix}
              </p>
            ) : null}
          </>
        )}

        {error ? (
          <p className="m-err" role="alert">
            {error}
          </p>
        ) : null}
      </div>

      <div className="m-acts">
        {verified ? (
          // 인증은 끝났고 알림 등록만 실패한 상태: 「확인」을 다시 누르게 하지 않고 돌아갈 길을 준다.
          <Link className="cta" href="/me" data-go-me>
            {C.goMe}
          </Link>
        ) : step === 1 ? (
          <button type="submit" className="cta" data-send disabled={busy}>
            {busy ? C.sending : C.send}
          </button>
        ) : (
          <button type="submit" className="cta" data-verify disabled={busy}>
            {busy ? C.verifying : C.verify}
          </button>
        )}
        <Link className="lbtn m-skip" href={skipHref}>
          {verified ? C.backToCourse : C.skip}
        </Link>
      </div>
    </form>
  );
}
