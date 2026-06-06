// Tipos del esquema de Supabase.
// Regenera desde la BD con:  npm run db:types   (requiere `npm run db:start` corriendo)
// Esto es un placeholder mínimo para que TypeScript compile antes de generar los tipos;
// el comando de arriba lo SOBREESCRIBE con los tipos reales de tus tablas/RLS/funciones.
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: Record<string, never>;
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: {
      app_role: "alumno" | "tutor" | "admin";
    };
    CompositeTypes: Record<string, never>;
  };
};
