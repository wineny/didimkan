import BigToggle from "./BigToggle";

export default function TopBar() {
  return (
    <header className="top">
      <div className="logo" role="img" aria-label="디딤칸">
        <svg width="24" height="24" viewBox="0 0 39 39" aria-hidden="true">
          <rect x="0" y="26" width="13" height="13" fill="var(--logo-ink)" />
          <rect x="13" y="13" width="13" height="26" fill="var(--logo-ink)" />
          <rect x="26" y="0" width="13" height="13" fill="var(--accent)" />
        </svg>
        <b>
          디딤칸<i>.</i>
        </b>
      </div>
      <div className="tbtns">
        <BigToggle />
        <button type="button" className="tbtn tbtn-login" disabled aria-disabled="true">
          로그인 준비 중
        </button>
      </div>
    </header>
  );
}
