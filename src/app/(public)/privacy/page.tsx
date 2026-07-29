import { LEGAL_DOCS, LegalDocPage } from "@/components/legal/legal-doc";

export const metadata = {
  title: `${LEGAL_DOCS.privacy.title} · Enséñame Ya`,
  description: LEGAL_DOCS.privacy.intro,
};

export default function PrivacyPage() {
  return <LegalDocPage slug="privacy" />;
}
