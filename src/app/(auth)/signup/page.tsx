import Link from "next/link";

import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { SignupForm } from "./signup-form";

export const metadata = { title: "Crear cuenta · Enséñame Ya" };

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; ref?: string }>;
}) {
  const { next, ref } = await searchParams;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Crea tu cuenta</CardTitle>
        <CardDescription>
          Aprende o enseña en clases 1:1 en vivo.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <SignupForm next={next ?? null} referralCode={ref ?? null} />
      </CardContent>
      <CardFooter className="justify-center text-sm text-muted-foreground">
        ¿Ya tienes cuenta?&nbsp;
        <Link
          href={`/login${next ? `?next=${encodeURIComponent(next)}` : ""}`}
          className="font-medium text-foreground hover:underline"
        >
          Inicia sesión
        </Link>
      </CardFooter>
    </Card>
  );
}
