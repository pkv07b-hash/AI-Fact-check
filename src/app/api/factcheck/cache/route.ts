import { NextResponse } from "next/server";
import { globalCache } from "@/lib/cache";

export async function GET() {
  try {
    const cachedData = globalCache.getAll();
    return NextResponse.json({
      count: cachedData.length,
      entries: cachedData
    });
  } catch (error) {
    console.error("Cache API Error:", error);
    return NextResponse.json({ error: "Failed to fetch cache" }, { status: 500 });
  }
}
