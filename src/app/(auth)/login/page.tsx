import Link from "next/link";

import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { LoginForm } from "./login-form";

export const metadata = { title: "Entrar · Enséñame Ya" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Inicia sesión</CardTitle>
        <CardDescription>Entra para reservar y ver tus clases.</CardDescription>
      </CardHeader>
      <CardContent>
        <LoginForm next={next ?? null} oauthError={error === "oauth"} />
      </CardContent>
      <CardFooter className="justify-center text-sm text-muted-foreground">
        ¿No tienes cuenta?&nbsp;
        <Link
          href={`/signup${next ? `?next=${encodeURIComponent(next)}` : ""}`}
          className="font-medium text-foreground hover:underline"
        >
          Crea una
        </Link>
      </CardFooter>
    </Card>
  );
}
