import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "디딤칸",
  description: "한 칸씩 오르는 배움 계단",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

const BIG_INIT = `try{if(localStorage.getItem('didim.big')==='1'){document.documentElement.dataset.big='1'}}catch(e){}`;

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
