import { LEGAL_DOCS, LegalDocPage } from "@/components/legal/legal-doc";

export const metadata = {
  title: `${LEGAL_DOCS.cookies.title} · Enséñame Ya`,
  description: LEGAL_DOCS.cookies.intro,
};

export default function CookiesPage() {
  return <LegalDocPage slug="cookies" />;
}
