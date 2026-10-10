import { NextResponse } from "next/server";
import { listAreas } from "@/db/queries";

export const revalidate = 3600;

export async function GET() {
  return NextResponse.json(await listAreas());
}
