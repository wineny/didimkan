import type { Metadata } from "next";
import IntroDeck from "@/components/IntroDeck";
import { M2_COPY } from "@/lib/copy";

const C = M2_COPY.intro;

// openGraph 는 layout 과 합쳐지지 않으므로 siteName·locale·type·이미지를 다시 적는다(/about 과 같은 이유).
export const metadata: Metadata = {
  title: C.title,
  description: C.sub,
  openGraph: {
    title: C.title,
    description: C.sub,
    siteName: "디딤칸",
    locale: "ko_KR",
    type: "website",
    images: [{ url: "/opengraph-image.png", width: 1200, height: 630 }],
  },
};

/** 기관에 보내는 소개 자료(소개 이미지 v3 7장). 폰 틀 없이 화면 전체를 쓴다. 특정 장은 /intro#3 처럼 연다. */
export default function IntroPage() {
  return <IntroDeck />;
}
