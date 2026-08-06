import { NextResponse } from "next/server";
import { fetchHirebaseEmployers } from "@/lib/hirebaseEmployers.server";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET() {
  const result = await fetchHirebaseEmployers();
  return NextResponse.json(result);
}
