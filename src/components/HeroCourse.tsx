import Link from "next/link";
import { sourceLine, type CourseView } from "./CourseRow";

/** 홈 맨 위: 지금 칸의 첫 강좌를 숲색 카드로 (A2, 사진 없음). 라벨 · 강좌명 · 센터·요일시간 · 수강료·정원 + 접수 칩 · 출처. */
export default function HeroCourse({ v }: { v: CourseView }) {
  return (
    <Link href={v.href} className="hero-c" data-course>
      <span className="hero-chip">지금 칸</span>
      <span className="hero-t">{v.title}</span>
      <span className="hero-s">
        {v.institution} · <span className="only-n">{v.when}</span>
        <span className="only-b">{v.whenShort}</span>
      </span>
      <span className="hero-row">
        <span className="hero-fee only-n">
          {v.fee}
          {v.capacity ? ` · ${v.capacity}` : ""}
        </span>
        <span className="hero-dd">{v.dday}</span>
      </span>
      <p className="meta hero-src">{sourceLine(v)}</p>
    </Link>
  );
}
