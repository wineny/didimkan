import Link from "next/link";
import Shell from "@/components/Shell";
import { FOOT_NOTE } from "@/lib/copy";
import Intro from "@/components/Intro";
import StairChoice from "@/components/StairChoice";

export default async function Home({ searchParams }: PageProps<"/">) {
  const sp = await searchParams;
  return (
    <Shell
      dev={sp.dev === "1"}
      foot={
        <>
          {FOOT_NOTE} <span aria-hidden="true">·</span>{" "}
          <Link href="/about" className="link">
            기관 안내
          </Link>
        </>
      }
    >
      <Intro />
      <div className="q-view">
        <StairChoice />
      </div>
    </Shell>
  );
}
