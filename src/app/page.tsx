import Shell from "@/components/Shell";
import StairChoice from "@/components/StairChoice";

export default async function Home({ searchParams }: PageProps<"/">) {
  const sp = await searchParams;
  return (
    <Shell dev={sp.dev === "1"} foot="실제 접수는 기관에 확인하세요 · 그림은 AI 생성 시범 이미지">
      <StairChoice />
    </Shell>
  );
}
