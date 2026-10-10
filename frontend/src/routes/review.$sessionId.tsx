import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { Clock, FileQuestion, Loader2 } from "lucide-react";

import { AnonymizationWorkspace } from "@/components/anonymization-workspace";
import { Button } from "@/components/ui/button";
import { SessionError, getSession, waitForSession } from "@/lib/anonymize/client";

export const Route = createFileRoute("/review/$sessionId")({
  head: () => ({
    meta: [
      { title: "Review changes — Hidden" },
      { name: "description", content: "Review and adjust what gets hidden before downloading the anonymized document." },
      { property: "og:title", content: "Review changes — Hidden" },
      { property: "og:description", content: "Review and adjust detected personal data before downloading." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ReviewPage,
});

function ReviewPage() {
  const { sessionId } = Route.useParams();
  const query = useQuery({
    queryKey: ["session", sessionId],
    queryFn: async () => waitForSession(await getSession(sessionId)),
    retry: (count, err) => !(err instanceof SessionError && err.code !== "failed") && count < 2,
    staleTime: Infinity,
  });

  if (query.data) return <AnonymizationWorkspace initialSession={query.data} />;

  if (query.isError) {
    const err = query.error;
    const expired = err instanceof SessionError && err.code === "expired";
    const Icon = expired ? Clock : FileQuestion;
    return (
      <main className="flex min-h-screen items-center justify-center bg-background px-5">
        <div className="max-w-sm text-center">
          <Icon className="mx-auto size-10 text-muted-foreground" strokeWidth={1.4} />
          <h1 className="mt-5 text-2xl font-semibold">
            {expired ? "This review has expired" : err instanceof SessionError && err.code === "not_found" ? "Review not found" : "Couldn't load this review"}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {expired
              ? "Reviews last one hour and close when the server stops. Open the document again to start a new one."
              : "Check the link, or start again with your document."}
          </p>
          <Button asChild className="mt-6 h-11 rounded-full px-6">
            <Link to="/">Open Hidden</Link>
          </Button>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background">
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Loading review
      </p>
    </main>
  );
}
