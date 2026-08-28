import {
  Button,
  Card,
  FieldError,
  Form,
  Input,
  Label,
  TextField,
} from "@heroui/react";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";

import { loginPath, returnPath } from "../auth/navigation";
import { BrandLogo } from "../components/BrandLogo";
import { isAuthenticated, redirect, signIn } from "../server/session";

export const Route = createFileRoute("/login")({
  validateSearch: z.object({
    rejected: z.boolean().optional(),
    returnTo: z.string().optional(),
  }),
  head: () => ({ meta: [{ title: "Sign in · VitroFlow" }] }),
  server: {
    handlers: {
      GET: ({ request, next }) => {
        const destination = returnPath(
          new URL(request.url).searchParams.get("returnTo"),
        );
        return isAuthenticated(request) ? redirect(destination) : next();
      },
      POST: async ({ request }) => {
        const form = await request.formData();
        const destination = returnPath(form.get("returnTo"));
        const accepted = signIn(String(form.get("password") ?? ""));
        return redirect(accepted ? destination : loginPath(destination, true));
      },
    },
  },
  component: LoginPage,
});

function LoginPage() {
  const { rejected, returnTo: requestedReturnPath } = Route.useSearch();
  const destination = returnPath(requestedReturnPath);
  const [rejectionDismissed, setRejectionDismissed] = useState(false);

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
              Sign in
            </Card.Title>
          </Card.Header>
          <Form method="post" action="/login">
            <Card.Content>
              <input type="hidden" name="returnTo" value={destination} />
              <TextField
                variant="secondary"
                fullWidth
                isInvalid={Boolean(rejected) && !rejectionDismissed}
                isRequired
                autoFocus
                name="password"
                onChange={() => setRejectionDismissed(true)}
                type="password"
              >
                <Label>Password</Label>
                <Input autoComplete="current-password" />
                <FieldError>Incorrect password.</FieldError>
              </TextField>
            </Card.Content>
            <Card.Footer className="mt-4 flex flex-col gap-2">
              <Button type="submit" variant="primary" fullWidth>
                Sign in
              </Button>
            </Card.Footer>
          </Form>
        </Card>
      </div>
    </main>
  );
}
