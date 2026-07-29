import { LEGAL_DOCS, LegalDocPage } from "@/components/legal/legal-doc";

export const metadata = {
  title: `${LEGAL_DOCS.terms.title} · Enséñame Ya`,
  description: LEGAL_DOCS.terms.intro,
};

export default function TermsPage() {
  return <LegalDocPage slug="terms" />;
}
