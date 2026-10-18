import type { ReactNode } from "react";
import DevTabs from "./DevTabs";
import { FOOT_NOTE } from "@/lib/copy";
import TopBar from "./TopBar";

/** 모든 화면의 틀: TopBar + (main, 버튼) + 하단 한 줄. 폰 프레임은 layout 의 .frame. */
export default function Shell({
  children,
  dev = false,
  foot = FOOT_NOTE,
}: {
  children: ReactNode;
  dev?: boolean;
  foot?: ReactNode;
}) {
  return (
    <div className="v4">
      <TopBar />
      {children}
      <div className="foot">{foot}</div>
      {dev && <DevTabs />}
    </div>
  );
}
