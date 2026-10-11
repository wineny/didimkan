import Link from "next/link";
import { feeChip, sourceLine, type CourseView } from "./CourseRow";

/** 홈 맨 위: 지금 칸의 첫 강좌를 숲색 카드로 (A2, 사진 없음). 라벨 · 강좌명 · 센터·요일시간 · 수강료·정원 + 접수 칩 · 출처.
 *  모르는 값(요일·수강료·접수일)은 따로 「확인 안 됨」을 세 번 쓰지 않고 칩 하나로 모은다(2026-10-11). */
export default function HeroCourse({ v }: { v: CourseView }) {
  const fee = feeChip(v);
  return (
    <Link href={v.href} className="hero-c" data-course>
      <span className="hero-chip">지금 칸</span>
      <span className="hero-t">{v.title}</span>
      <span className="hero-s">
        {v.institution}
        {v.whenKnown && (
          <>
            {" · "}
            <span className="only-n">{v.when}</span>
            <span className="only-b">{v.whenShort}</span>
          </>
        )}
      </span>
      <span className="hero-row">
        {fee && <span className="hero-fee only-n">{fee}</span>}
        {v.applyKnown && <span className="hero-dd">{v.dday}</span>}
        {v.unknownLine && <span className="hero-dd">{v.unknownLine}</span>}
      </span>
      <p className="meta hero-src">{sourceLine(v)}</p>
    </Link>
  );
}
