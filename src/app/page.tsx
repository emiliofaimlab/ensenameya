export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col justify-center gap-8 px-6 py-16">
      <header className="flex flex-col gap-2">
        <span className="text-sm font-medium uppercase tracking-widest text-zinc-500">
          MVP Web
        </span>
        <h1 className="text-4xl font-semibold tracking-tight">Enséñame Ya</h1>
        <p className="text-lg text-zinc-600 dark:text-zinc-400">
          Marketplace de tutorías 1:1 en vivo entre alumnos y tutores.
        </p>
      </header>

      <section className="rounded-xl border border-zinc-200 p-6 dark:border-zinc-800">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-500">
          Infraestructura
        </h2>
        <ul className="flex flex-col gap-2 text-sm">
          <li>✅ Next.js (App Router) + TypeScript + Tailwind</li>
          <li>✅ Supabase: Auth + Postgres + RLS (clientes wired)</li>
          <li>✅ Migración inicial: profiles + user_roles + RLS default-deny</li>
        </ul>
      </section>

      <section className="rounded-xl border border-zinc-200 p-6 dark:border-zinc-800">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-500">
          Para arrancar el backend local
        </h2>
        <ol className="flex flex-col gap-2 text-sm">
          <li>
            1. Inicia Docker Desktop, luego:{" "}
            <code className="rounded bg-zinc-100 px-1.5 py-0.5 dark:bg-zinc-800">
              npm run db:start
            </code>
          </li>
          <li>
            2. Genera los tipos:{" "}
            <code className="rounded bg-zinc-100 px-1.5 py-0.5 dark:bg-zinc-800">
              npm run db:types
            </code>
          </li>
          <li>
            3. Studio en{" "}
            <code className="rounded bg-zinc-100 px-1.5 py-0.5 dark:bg-zinc-800">
              http://127.0.0.1:54323
            </code>
          </li>
        </ol>
      </section>

      <footer className="text-xs text-zinc-400">
        Documentación de contexto en <code>docs/context/</code>
      </footer>
    </main>
  );
}
