import { Brand } from "@/components/brand";
import { AuthForm } from "@/components/auth-form";
import { isSupabaseConfigured } from "@/lib/env";

type Props = React.ComponentProps<typeof AuthForm>;
export function AuthPage(props: Props) {
  return (
    <main id="main" className="grid min-h-dvh content-start gap-8 px-5 py-8">
      <div className="mx-auto w-full max-w-md"><Brand /></div>
      <AuthForm {...props} notice={props.notice ?? (isSupabaseConfigured() ? undefined : "Backend not configured: run `npm run db:up` (see README). You can still explore the demo.")} />
    </main>
  );
}
