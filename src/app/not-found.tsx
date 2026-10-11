import Button from "@/components/Button";
import Shell from "@/components/Shell";

/** 없는 주소: 아쉬워하는 고슴도치 + 처음으로 */
export default function NotFound() {
  return (
    <Shell>
      <main className="body">
        <div className="m-hello">
          <div className="m-hello-tx">
            <h1 className="h1">찾는 화면이 없어요</h1>
            <p className="sub gap-sub">주소가 바뀌었거나 없어졌을 수 있어요.</p>
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="m-hello-img" src="/char/h-sorry.webp" alt="" aria-hidden="true" />
        </div>
      </main>
      <Button href="/">처음으로</Button>
    </Shell>
  );
}
