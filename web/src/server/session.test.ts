import { expect, test } from "bun:test";

import { Route as LoginRoute } from "../routes/login";
import { redirect } from "./session";

test("document redirects use a relative Location", () => {
  const response = redirect("/login?rejected=true");
  expect(response.status).toBe(303);
  expect(response.headers.get("Location")).toBe("/login?rejected=true");
});

test("passwordless login GET returns to the requested workbench page", () => {
  const handlers = LoginRoute.options.server?.handlers as
    | {
        GET?: (context: { request: Request; next: () => Response }) => Response;
      }
    | undefined;
  const response = handlers?.GET?.({
    request: new Request(
      "http://example.invalid/login?returnTo=%2Fstatus%3Fworkers%3Donline",
    ),
    next: () => new Response("ok"),
  });
  expect(response?.status).toBe(303);
  expect(response?.headers.get("Location")).toBe("/status?workers=online");
});
