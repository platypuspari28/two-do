import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default function LoginPage() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 bg-background px-6 py-20 text-center text-foreground">
      <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
      <p className="max-w-sm text-sm leading-6 text-muted-foreground">
        Magic-link sign in is coming in the next phase. For now, the foundation
        is live and deploying automatically.
      </p>
      <Link href="/" className={cn(buttonVariants({ variant: "outline" }))}>
        Back home
      </Link>
    </main>
  );
}
