import { ExplorerPage } from "@/src/components/explorer-page";
import { Suspense } from "react";

export default function Home() {
  return (
    <Suspense fallback={<main className="mx-auto min-h-screen w-full max-w-6xl px-4 py-10 text-slate-200">Loading explorer...</main>}>
      <ExplorerPage />
    </Suspense>
  );
}
