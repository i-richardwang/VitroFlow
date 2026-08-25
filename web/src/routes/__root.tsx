/// <reference types="vite/client" />
import type { ReactNode } from "react";

import { Button, Link, RouterProvider } from "@heroui/react";
import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRoute,
  useNavigate,
} from "@tanstack/react-router";

import { getSession } from "../server/auth";
import appCss from "../styles/app.css?url";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "VitroFlow" },
    ],
    links: [{ rel: "stylesheet", href: appCss }],
  }),
  loader: () => getSession(),
  component: RootComponent,
  notFoundComponent: NotFoundPage,
});

function RootComponent() {
  const navigate = useNavigate();
  const { signedIn } = Route.useLoaderData();
  return (
    <RootDocument>
      <RouterProvider navigate={(href) => navigate({ to: href })}>
        <header className="flex h-12 shrink-0 items-center gap-3 border-b border-separator bg-surface px-6">
          <Link
            href="/"
            className="text-sm font-semibold tracking-tight text-foreground"
          >
            VitroFlow
          </Link>
          <span className="text-xs text-muted">Seed annotation workbench</span>
          <nav className="ml-4 flex items-center gap-3 text-xs">
            <Link href="/">Runs</Link>
            <Link href="/jobs">Jobs</Link>
          </nav>
          {signedIn && (
            <form method="post" action="/logout" className="ml-auto">
              <Button type="submit" variant="ghost" size="sm">
                Sign out
              </Button>
            </form>
          )}
        </header>
        <div className="min-h-0 flex-1 overflow-auto">
          <Outlet />
        </div>
      </RouterProvider>
    </RootDocument>
  );
}

function NotFoundPage() {
  return (
    <main className="mx-auto flex min-h-full max-w-lg flex-col items-center justify-center px-8 text-center">
      <p className="font-mono text-xs text-muted">404</p>
      <h1 className="mt-2 text-xl font-semibold tracking-tight">
        Page not found
      </h1>
      <p className="mt-2 text-sm text-muted">
        The requested page does not exist in this workbench.
      </p>
      <Link href="/" className="mt-5 text-sm font-medium">
        Return to runs
      </Link>
    </main>
  );
}

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body className="flex h-dvh flex-col overflow-hidden bg-background text-[13px] leading-normal text-foreground antialiased">
        {children}
        <Scripts />
      </body>
    </html>
  );
}
