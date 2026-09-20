import { AuthShell } from "@/components/auth/auth-shell";

export default function AuthenticationLayout({ children }: LayoutProps<"/">) {
  return <AuthShell>{children}</AuthShell>;
}
