import type { Metadata } from "next";

import { CamaraCelular } from "./camara-celular";

export const metadata: Metadata = {
  title: "Cámara del celular · Enséñame Ya",
  robots: { index: false, follow: false },
};

/** Segunda cámara · a donde lleva el QR de la sala. Ver `CamaraCelular`. */
export default function CelularPage() {
  return <CamaraCelular />;
}
