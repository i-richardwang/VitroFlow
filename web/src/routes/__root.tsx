/// <reference types="vite/client" />
import type { ReactNode } from "react";

import { RouterProvider, Toast } from "@heroui/react";
import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRoute,
  useNavigate,
} from "@tanstack/react-router";

import { WorkbenchNotice } from "../components/WorkbenchNotice";
import appCss from "../styles/app.css?url";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "VitroFlow" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: "/logo.svg", type: "image/svg+xml" },
    ],
  }),
  component: RootComponent,
  notFoundComponent: NotFoundPage,
});

function RootComponent() {
  const navigate = useNavigate();
  return (
    <RootDocument>
      <RouterProvider navigate={(href) => navigate({ to: href })}>
        <div className="flex min-h-0 flex-1 flex-col">
          <Outlet />
        </div>
        <Toast.Provider placement="bottom end" />
      </RouterProvider>
    </RootDocument>
  );
}

function NotFoundPage() {
  return <WorkbenchNotice title="Page not found" />;
}

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body className="flex h-dvh flex-col overflow-hidden bg-background text-foreground antialiased">
        {children}
        <Scripts />
      </body>
    </html>
  );
}
