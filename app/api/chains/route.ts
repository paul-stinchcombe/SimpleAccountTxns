import { NextResponse } from "next/server";

import { listChainsWithPlatform } from "@/src/lib/platform";

export async function GET() {
  try {
    const chains = await listChainsWithPlatform();
    return NextResponse.json({ chains });
  } catch (error) {
    return NextResponse.json(
      {
        message: "Unable to load chains from the database.",
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
