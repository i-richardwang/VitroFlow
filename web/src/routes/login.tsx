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
import { z } from "zod";

import { BrandIcon } from "../components/icons";
import { isAuthenticated, redirect, signIn } from "../server/session";

export const Route = createFileRoute("/login")({
  validateSearch: z.object({ rejected: z.boolean().optional() }),
  server: {
    handlers: {
      GET: ({ request, next }) =>
        isAuthenticated(request) ? redirect(new URL("/", request.url)) : next(),
      POST: async ({ request }) => {
        const form = await request.formData();
        const accepted = signIn(String(form.get("password") ?? ""));
        return redirect(
          new URL(accepted ? "/" : "/login?rejected=true", request.url),
        );
      },
    },
  },
  component: LoginPage,
});

function LoginPage() {
  const { rejected } = Route.useSearch();

  return (
    <main className="flex flex-1 flex-col items-center justify-center bg-surface-secondary p-6 md:p-10">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <div className="flex items-center gap-2 self-center font-medium">
          <div className="flex size-6 items-center justify-center rounded-md bg-accent text-accent-foreground">
            <BrandIcon />
          </div>
          VitroFlow
        </div>
        <Card className="w-full">
          <Card.Header>
            <Card.Title>Sign in</Card.Title>
            <Card.Description>
              Enter the workbench password to continue.
            </Card.Description>
          </Card.Header>
          <Form method="post" action="/login">
            <Card.Content>
              <TextField
                fullWidth
                isInvalid={rejected}
                isRequired
                autoFocus
                name="password"
                type="password"
              >
                <Label>Password</Label>
                <Input autoComplete="current-password" />
                <FieldError>Incorrect password.</FieldError>
              </TextField>
            </Card.Content>
            <Card.Footer className="mt-4">
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
