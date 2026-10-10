import Link from "next/link";
import { photoOf, sourceLine, type CourseView } from "./CourseRow";

/** 홈 맨 위: 지금 칸의 첫 강좌를 사진 주인공(280px)으로. 사진 안에 강좌명·센터·요일시간·접수일 D-n. */
export default function HeroCourse({ v }: { v: CourseView }) {
  const src = photoOf(v.category);
  return (
    <>
      <Link href={v.href} className={src ? "hero-c" : "hero-c hero-plain"} data-course>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {src && <img src={src} alt="" />}
        {src && <span className="hero-scrim" aria-hidden="true" />}
        <span className="hero-txt">
          <span className="hero-chip">지금 칸</span>
          <span className="hero-t">{v.title}</span>
          <span className="hero-s">
            {v.institution} · <span className="only-n">{v.when}</span>
            <span className="only-b">{v.whenShort}</span>
          </span>
          <span className="hero-fee only-n">
            {v.fee}
            {v.capacity ? ` · ${v.capacity}` : ""}
          </span>
          <span className="hero-dd">{v.dday}</span>
        </span>
      </Link>
      <p className="meta hero-src">{sourceLine(v)}</p>
    </>
  );
}
