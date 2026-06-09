import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const features = [
  {
    title: "Propose & approve",
    description:
      "Suggest a plan for a day and time slot. It only lands on the shared calendar once you both say yes.",
  },
  {
    title: "Never double-book",
    description:
      "Add your personal commitments so the two of you can always see when the other is busy.",
  },
  {
    title: "Date ideas, sorted",
    description:
      "Fresh events happening today, tomorrow, or this weekend — ready to propose in a tap.",
  },
];

export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center bg-background px-6 py-20 text-foreground">
      <div className="flex w-full max-w-3xl flex-col items-center text-center">
        <span className="rounded-full border border-border px-3 py-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">
          Planning, together
        </span>

        <h1 className="mt-6 text-6xl font-semibold tracking-tight sm:text-7xl">
          two&#8209;do
        </h1>

        <p className="mt-5 max-w-xl text-lg leading-8 text-muted-foreground">
          One shared calendar for the two of you. Propose plans, approve each
          other&apos;s, keep personal time in view, and find something fun to do.
        </p>

        <div className="mt-9 flex flex-col gap-3 sm:flex-row">
          <Link href="/login" className={cn(buttonVariants({ size: "lg" }))}>
            Get started
          </Link>
          <Link
            href="/login"
            className={cn(buttonVariants({ variant: "outline", size: "lg" }))}
          >
            Sign in
          </Link>
        </div>
      </div>

      <div className="mt-20 grid w-full max-w-4xl gap-4 sm:grid-cols-3">
        {features.map((feature) => (
          <div
            key={feature.title}
            className="rounded-xl border border-border bg-card p-5 text-left"
          >
            <h2 className="text-sm font-semibold text-card-foreground">
              {feature.title}
            </h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              {feature.description}
            </p>
          </div>
        ))}
      </div>
    </main>
  );
}
