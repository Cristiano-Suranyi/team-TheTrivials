import { createFileRoute } from "@tanstack/react-router";
import { AnonymizationWorkspace } from "@/components/anonymization-workspace";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Hidden — Private document anonymization" },
      {
        name: "description",
        content: "Detect, review, and mask sensitive data while preserving your document's meaning and structure.",
      },
      { property: "og:title", content: "Hidden — Private document anonymization" },
      {
        property: "og:description",
        content: "A focused workspace for reviewing and masking sensitive document data.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function Index() {
  return <AnonymizationWorkspace />;
}
