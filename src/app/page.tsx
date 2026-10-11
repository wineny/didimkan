import Shell from "@/components/Shell";
import Intro from "@/components/Intro";
import StairChoice from "@/components/StairChoice";

export default async function Home({ searchParams }: PageProps<"/">) {
  const sp = await searchParams;
  return (
    <Shell dev={sp.dev === "1"}>
      <Intro />
      <div className="q-view">
        <StairChoice />
      </div>
    </Shell>
  );
}
