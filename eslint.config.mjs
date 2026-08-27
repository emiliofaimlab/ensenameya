import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Los worktrees que dejan los agentes son COPIAS ENTERAS del proyecto, con
    // su `.next` y su `node_modules` dentro (5,1 GB en 12 copias al escribir
    // esto). ESLint no lee `.gitignore` ni `.git/info/exclude`, así que los
    // recorría todos: `npm run lint` devolvía 308.654 problemas —18.252 de
    // ellos "errores"— de los cuales CERO eran de `src/`. Con el comando
    // inutilizable, el lint dejaba de ser una puerta y pasaba a ser ruido.
    "**/.claude/worktrees/**",
  ]),
]);

export default eslintConfig;
