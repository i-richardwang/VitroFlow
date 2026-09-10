import { Button, Card, Link } from "@heroui/react";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";

import { authClient, continuation } from "../features/account/client";
import { BrandLogo } from "../ui/BrandLogo";
import { describeOAuthClient } from "../functions/integrations";
import { useAsyncAction } from "../ui/hooks/useAsyncAction";
import { m } from "../paraglide/messages";

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
  head: () => ({
    meta: [{ title: `${m.consent_allow()} · ${m.app_name()}` }],
  }),
  component: ConsentPage,
});

function ConsentPage() {
  const client = Route.useLoaderData();
  const { busy, run } = useAsyncAction();
  const [decided, setDecided] = useState(false);

  const decide = (accept: boolean) =>
    void run(async () => {
      const { data, error } = await authClient.oauth2.consent({ accept });
      if (error) throw new Error(error.message ?? m.consent_failed());
      const next = continuation(data);
      if (!next) throw new Error(m.consent_expired());
      return next;
    }, m.consent_failed()).then((result) => {
      if (!result.ok) return;
      setDecided(true);
      window.location.assign(result.value);
    });

  return (
    <main className="flex flex-1 flex-col items-center justify-center bg-surface-secondary p-6 md:p-10">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <header className="flex items-center gap-2.5 self-center">
          <BrandLogo className="size-10" />
          <span className="text-sm font-semibold">{m.app_name()}</span>
        </header>
        <Card className="w-full">
          <Card.Header>
            <Card.Title render={(props) => <h1 {...props} />}>
              {m.consent_title({ client: client.name })}
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
              {m.consent_deny()}
            </Button>
            <Button
              variant="primary"
              fullWidth
              isDisabled={busy || decided}
              onPress={() => decide(true)}
            >
              {busy || decided ? m.consent_authorizing() : m.consent_allow()}
            </Button>
          </Card.Footer>
        </Card>
      </div>
    </main>
  );
}
