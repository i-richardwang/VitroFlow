import { Button, Card, Link } from "@heroui/react";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";

import { authClient, continuation } from "../auth/client";
import { BrandLogo } from "../components/BrandLogo";
import { describeOAuthClient } from "../functions/integrations";
import { useAsyncAction } from "../hooks/useAsyncAction";

/**
 * The consent step of an MCP client's authorization request. The signed
 * request stays in the page's query; the auth client forwards it with the
 * decision, and the authorization server answers with where to go next.
 */
export const Route = createFileRoute("/consent")({
  validateSearch: z.object({ client_id: z.string() }).loose(),
  loaderDeps: ({ search }) => ({ clientId: search.client_id }),
  loader: ({ deps }) =>
    describeOAuthClient({ data: { clientId: deps.clientId } }),
  head: () => ({ meta: [{ title: "Authorize · VitroFlow" }] }),
  component: ConsentPage,
});

function ConsentPage() {
  const client = Route.useLoaderData();
  const { busy, run } = useAsyncAction();
  const [decided, setDecided] = useState(false);

  const decide = (accept: boolean) =>
    void run(async () => {
      const { data, error } = await authClient.oauth2.consent({ accept });
      if (error) throw new Error(error.message ?? "Authorization failed");
      const next = continuation(data);
      if (!next) throw new Error("The authorization request has expired");
      return next;
    }, "Authorization failed").then((result) => {
      if (!result.ok) return;
      setDecided(true);
      window.location.assign(result.value);
    });

  return (
    <main className="flex flex-1 flex-col items-center justify-center bg-surface-secondary p-6 md:p-10">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <header className="flex items-center gap-2.5 self-center">
          <BrandLogo className="size-10" />
          <span className="text-sm font-semibold">VitroFlow</span>
        </header>
        <Card className="w-full">
          <Card.Header>
            <Card.Title render={(props) => <h1 {...props} />}>
              Authorize {client.name}
            </Card.Title>
            {client.uri ? (
              <Card.Description>
                <Link href={client.uri} target="_blank" rel="noreferrer">
                  {client.uri}
                </Link>
              </Card.Description>
            ) : null}
          </Card.Header>
          <Card.Footer className="flex gap-2">
            <Button
              variant="tertiary"
              fullWidth
              isDisabled={busy || decided}
              onPress={() => decide(false)}
            >
              Deny
            </Button>
            <Button
              variant="primary"
              fullWidth
              isDisabled={busy || decided}
              onPress={() => decide(true)}
            >
              {busy || decided ? "Authorizing…" : "Allow"}
            </Button>
          </Card.Footer>
        </Card>
      </div>
    </main>
  );
}
