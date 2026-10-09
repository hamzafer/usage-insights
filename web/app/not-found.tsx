import Link from "next/link";
import { EmptyState } from "@/components/states";

export default function NotFound() {
  return (
    <EmptyState title="Page not found">
      Go back to the{" "}
      <Link href="/" className="text-foreground underline underline-offset-4">
        Overview
      </Link>
      .
    </EmptyState>
  );
}
