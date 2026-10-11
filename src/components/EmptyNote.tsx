import type { ReactNode } from "react";

interface EmptyNoteProps {
  className: string;
  children: ReactNode;
}

/** 빈 화면 안내: 가운데 빈 씨앗 화분(장식) + 문구. 고슴도치는 화면당 한 번이라 여기엔 쓰지 않는다. */
export default function EmptyNote({ className, children }: EmptyNoteProps) {
  return (
    <div className="empty-box">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="empty-pot" src="/char/i-pot-seed.webp" alt="" aria-hidden="true" />
      <p className={className}>{children}</p>
    </div>
  );
}
