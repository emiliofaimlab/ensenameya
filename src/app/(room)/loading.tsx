/**
 * P26 · La espera de «Entrar a sala». Sin este fichero no había ninguna señal:
 * se pulsaba y la pantalla anterior se quedaba quieta los 6-8 s que tardaba la
 * página en leer sesión, fecha, chat e inscritos —parecía que el enlace no
 * hacía nada—.
 *
 * Es el esqueleto de la ANTESALA (cabecera, rótulo, título, n.º de sesión, el
 * aviso de grabación y el botón), que es lo primero que se ve al llegar. Sin
 * datos ni clientes a propósito: se pinta al instante, y lo que sea de
 * servidor llega con la página.
 */
export default function RoomLoading() {
  return (
    <div className="flex flex-1 flex-col">
      <div className="h-14 border-b" />
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-4 px-4 py-10">
        <div className="h-4 w-24 animate-pulse rounded bg-muted" />
        <div className="h-6 w-56 animate-pulse rounded bg-muted" />
        <div className="h-4 w-32 animate-pulse rounded bg-muted" />
        <div className="h-32 w-full animate-pulse rounded bg-muted" />
        <div className="h-11 w-40 animate-pulse rounded bg-muted" />
        <p className="sr-only" role="status">
          Preparando la sala…
        </p>
      </div>
    </div>
  );
}
