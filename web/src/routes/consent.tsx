import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";

import { authClient, continuation } from "../features/account/client";
import { AppBrand } from "../ui/BrandLogo";
import { describeOAuthClient } from "../functions/integrations";
import { MCP_SERVER_LABELS } from "../features/integrations/labels";
import { useAsyncAction } from "../ui/hooks/useAsyncAction";
import { AuthLayout } from "../ui/kit/AuthLayout";
import { Block } from "../ui/kit/Block";
import { Button } from "../ui/kit/Button";
import { Flexbox } from "../ui/kit/Flex";
import { PageSkeleton } from "../ui/kit/PageSkeleton";
import { Skeleton } from "../ui/kit/Skeleton";
import { TextLink } from "../ui/kit/TextLink";
import { documentTitle } from "../ui/documentTitle";
import { m } from "../paraglide/messages";

/**
 * The consent step of an MCP client's authorization request. The signed
 * request stays in the page's query; the auth client forwards it with the
 * decision, and the authorization server answers with where to go next.
 */
export const Route = createFileRoute("/consent")({
  validateSearch: z
    .object({
      client_id: z.string(),
      resource: z.union([z.string(), z.array(z.string())]).optional(),
    })
    .loose(),
  loaderDeps: ({ search }) => ({
    clientId: search.client_id,
    resources: [search.resource ?? []].flat(),
  }),
  loader: ({ deps }) => describeOAuthClient({ data: deps }),
  head: ({ loaderData }) => ({
    meta: [
      {
        title: documentTitle(
          loaderData && m.consent_title({ client: loaderData.name }),
        ),
      },
    ],
  }),
  pendingComponent: ConsentPending,
  component: ConsentPage,
  notFoundComponent: UnknownClientPage,
});

const brand = <AppBrand />;

function ConsentPage() {
  const client = Route.useLoaderData();
  const { busy, run } = useAsyncAction();
  const [choice, setChoice] = useState<boolean | null>(null);
  const [decided, setDecided] = useState(false);
  const pending = busy || decided;

  const decide = (accept: boolean) => {
    setChoice(accept);
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
  };

  return (
    <AuthLayout
      brand={brand}
      title={m.consent_title({ client: client.name })}
      description={
        client.uri ? (
          <TextLink href={client.uri} target="_blank" rel="noreferrer">
            {client.uri}
          </TextLink>
        ) : undefined
      }
    >
      {client.servers.length > 0 ? (
        <Flexbox gap={8}>
          <span className="text-fg-secondary">{m.consent_servers()}</span>
          <Flexbox gap={4}>
            {client.servers.map((server) => (
              <Block key={server} padding={16} variant="filled">
                {MCP_SERVER_LABELS[server]()}
              </Block>
            ))}
          </Flexbox>
        </Flexbox>
      ) : null}
      <ConsentDecisions choice={pending ? choice : null} onDecide={decide} />
    </AuthLayout>
  );
}

/** The consent card while the client is looked up: its title and the two decisions. */
function ConsentPending() {
  return (
    <AuthLayout
      brand={brand}
      title={<Skeleton width="9em" className="inline-block align-middle" />}
    >
      <PageSkeleton>
        <ConsentDecisions disabled />
      </PageSkeleton>
    </AuthLayout>
  );
}

/**
 * Allow and Deny. Once one is chosen, it spins and the other is disabled;
 * `disabled` holds both while there is nothing to decide yet.
 */
function ConsentDecisions({
  choice = null,
  disabled,
  onDecide,
}: {
  choice?: boolean | null;
  disabled?: boolean;
  onDecide?: (accept: boolean) => void;
}) {
  return (
    <Flexbox gap={12}>
      <Button
        block
        size="large"
        type="primary"
        disabled={disabled || choice === false}
        loading={choice === true}
        onClick={() => onDecide?.(true)}
      >
        {m.consent_allow()}
      </Button>
      <Button
        block
        size="large"
        disabled={disabled || choice === true}
        loading={choice === false}
        onClick={() => onDecide?.(false)}
      >
        {m.consent_deny()}
      </Button>
    </Flexbox>
  );
}

function UnknownClientPage() {
  return (
    <AuthLayout
      brand={brand}
      title={m.consent_unknown_client()}
      description={m.consent_unknown_client_description()}
    />
  );
}
