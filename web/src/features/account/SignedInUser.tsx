import { useNavigate, useRouter } from "@tanstack/react-router";
import { LogOut } from "lucide-react";

import { authClient } from "./client";
import type { WorkbenchUser } from "../../domain/auth/schema";
import { m } from "../../paraglide/messages";
import { useAsyncAction } from "../../ui/hooks/useAsyncAction";
import { ActionIcon } from "../../ui/kit/ActionIcon";
import { useAppShell } from "../../ui/kit/AppShell";
import { Text } from "../../ui/kit/Text";

export function SignedInUser({ user }: { user: WorkbenchUser }) {
  const router = useRouter();
  const navigate = useNavigate();
  const { collapsed } = useAppShell();
  const { busy, run } = useAsyncAction();

  const signOut = () =>
    void run(async () => {
      const { error } = await authClient.signOut();
      if (error) throw new Error(error.message);
      await router.invalidate();
      await navigate({ to: "/login" });
    }, m.sign_out_failed());

  const action = (
    <ActionIcon
      icon={LogOut}
      title={m.sign_out()}
      disabled={busy}
      onClick={signOut}
    />
  );

  if (collapsed) {
    return <div className="flex justify-center">{action}</div>;
  }
  return (
    <div className="flex items-center gap-2 ps-2">
      <Text ellipsis className="min-w-0 flex-1 font-medium">
        {user.name}
      </Text>
      {action}
    </div>
  );
}
