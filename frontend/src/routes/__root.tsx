import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Outlet, Link, createRootRouteWithContext } from "@tanstack/react-router";
export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: Root,
  notFoundComponent: () => <Problem title="Page not found" />,
  errorComponent: () => <Problem title="This page couldn't load. Please try again." />,
});
function Problem({ title }: { title: string }) {
  return <main className="min-h-screen grid place-content-center gap-6 text-center px-6">
    <h1 className="text-2xl font-semibold">{title}</h1>
    <Link className="text-primary underline" to="/">Open Hidden</Link>
  </main>;
}
function Root() {
  const { queryClient } = Route.useRouteContext();
  return <QueryClientProvider client={queryClient}><Outlet /></QueryClientProvider>;
}
