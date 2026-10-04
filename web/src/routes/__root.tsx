/// <reference types="vite/client" />
import type { ReactNode } from "react";

import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRoute,
} from "@tanstack/react-router";

import { ModalHost } from "../ui/kit/Modal";
import { Toaster } from "../ui/kit/Toast";
import { documentTitle } from "../ui/documentTitle";
import { RouteNotice } from "../ui/RouteNotice";
import { m } from "../paraglide/messages";
import { getLocale } from "../paraglide/runtime";
import appCss from "../styles/app.css?url";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: documentTitle() },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: "/logo.svg", type: "image/svg+xml" },
    ],
  }),
  component: RootComponent,
  notFoundComponent: NotFoundPage,
});

/** Sets the `dark` class from the system preference before the first paint. */
const SYNC_COLOR_SCHEME = `(()=>{try{const q=matchMedia("(prefers-color-scheme: dark)"),a=e=>document.documentElement.classList.toggle("dark",e.matches);a(q);q.addEventListener("change",a)}catch(e){}})()`;

function RootComponent() {
  return (
    <RootDocument>
      <div className="flex min-h-0 flex-1 flex-col">
        <Outlet />
      </div>
      <Toaster />
      <ModalHost />
    </RootDocument>
  );
}

function NotFoundPage() {
  return <RouteNotice title={m.not_found()} />;
}

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang={getLocale()} suppressHydrationWarning>
      <head>
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: a constant script that sets the scheme before the first paint */}
        <script dangerouslySetInnerHTML={{ __html: SYNC_COLOR_SCHEME }} />
        <HeadContent />
      </head>
      <body className="flex h-dvh flex-col overflow-hidden">
        {children}
        <Scripts />
      </body>
    </html>
  );
}
