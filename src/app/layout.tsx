import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://didimkan.vercel.app"),
  title: "디딤칸",
  description: "한 칸씩 오르는 배움 계단",
  // 카톡 등 공유 미리보기. 그림은 src/app/opengraph-image.png
  openGraph: {
    title: "디딤칸 — 한 칸씩, 동네 배움으로",
    description: "집에서 시작해도 괜찮아요. 지금 나갈 수 있는 만큼만 동네 강좌를 골라 드릴게요.",
    siteName: "디딤칸",
    locale: "ko_KR",
    type: "website",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

// 그리기 전에 크게 보기와 「첫 방문 소개를 봤는지」를 html 속성으로 단다(깜빡임 방지).
// 저장이 막힌 환경이면 소개를 건너뛴다(시작하기를 눌러도 기억할 수 없으므로).
const BIG_INIT = `try{var s=localStorage,d=document.documentElement.dataset;if(s.getItem('didim.big')==='1'){d.big='1'}if(s.getItem('didim.intro')==='1'||s.getItem('didim.st')||s.getItem('didim.area')){d.seen='1'}}catch(e){document.documentElement.dataset.seen='1'}`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ko" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: BIG_INIT }} />
      </head>
      <body>
        <div className="stage">
          <div className="frame">{children}</div>
        </div>
      </body>
    </html>
  );
}
