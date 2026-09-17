import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        // Next no versiona lo que hay en `public/`, así que no puede cachearlo
        // sin riesgo y lo sirve con `max-age=0, must-revalidate`: un viaje
        // condicional completo por delante del primer byte del video EN CADA
        // visita. En una red móvil con latencia alta eso es justo lo que hace
        // que el usuario baje antes de ver nada.
        //
        // Aquí la versión va en el NOMBRE (`-v2`), así que el `immutable` es
        // seguro: para invalidar se cambia el nombre del fichero, nunca esta
        // cabecera.
        source: "/:carpeta(video|img)/:fichero*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },
    ];
  },
};

export default nextConfig;
