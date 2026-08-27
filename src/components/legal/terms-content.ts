// Import relativo y con extensión, no `@/lib/company`: este módulo lo carga
// también `npm run check:terms` con node a pelo, que no resuelve el alias `@/`.
// Mismo motivo por el que `email-templates.ts` importa `./catalog/format.ts`.
import { COMPANY, COMPANY_ADDRESS_LINE } from "../../lib/company.ts";

/**
 * Términos y Condiciones — el contrato real, en inglés y español.
 *
 * FUENTE: «DLocal Legal Requirements» (Néstor Valderrama, 17-ago-2026), 39
 * secciones, entregado ya bilingüe. **Transcrito literalmente.** No es un texto
 * que escribamos nosotros y no se edita al gusto: cualquier cambio de redacción
 * lo decide quien lo redactó, no desarrollo.
 *
 * ⚠️ **EL INGLÉS GOBIERNA.** Lo dice el propio §38: en caso de conflicto entre
 * la versión inglesa y una traducción, prevalece la inglesa. Por eso `en` es la
 * versión canónica y la que enlaza la casilla del registro; el español está
 * «disponible después», que es como lo pidió el cliente.
 *
 * SUSTITUYE al texto que teníamos escrito desde el sistema (DD-06). Aquel
 * describía con precisión lo que la plataforma hace, pero le faltaba lo que un
 * contrato necesita y un revisor busca: identidad del prestador, ley aplicable
 * y jurisdicción. Este los trae (§33 y §39).
 *
 * ⚠️ LO QUE SE PIERDE AL SUSTITUIRLO, y cómo se compensa. El texto anterior
 * interpolaba los porcentajes desde `lib/policy.ts` para que no pudieran
 * divergir de lo que aplica `cancel_booking`. Un contrato no se puede
 * interpolar: los números del §13 y del §15 están escritos a mano porque así
 * los firmó el cliente. La garantía se traslada a `terms-content.check.ts`,
 * que compara los dos y rompe el build si dejan de coincidir. Hoy coinciden:
 * ≥24 h → 100 %, <24 h → 50 %, cancela el tutor → 100 %.
 *
 * ⚠️ El §2.1 (menores, perfiles dependientes bajo la cuenta de un adulto)
 * describe algo que el producto NO tiene. El texto es permisivo —«podrá»— así
 * que no miente, pero si algún día se construye, esta sección ya lo cubre.
 */

/**
 * Versión del documento. Es lo que se guarda junto a la aceptación de cada
 * usuario, así que **cambia cada vez que cambie el texto** — si no, no habría
 * forma de saber qué aceptó cada persona.
 *
 * Formato fecha para que sea legible en la base de datos sin consultar nada.
 */
export const TERMS_VERSION = "2026-08-17";

/** Un bloque de texto dentro de una sección. */
export type Bloque =
  /** Párrafo normal. */
  | string
  /** Lista con viñetas. */
  | string[]
  /** Lista numerada (§6: los pasos de la compra). */
  | { ol: string[] }
  /** Párrafo en negrita que hace de subtítulo (§13: los dos supuestos). */
  | { destacado: string };

export type Seccion = { titulo: string; bloques: Bloque[] };

export type TermsDoc = {
  locale: "en" | "es";
  /** Etiqueta del idioma, en su propio idioma. */
  idioma: string;
  title: string;
  actualizado: string;
  intro: Bloque[];
  secciones: Seccion[];
  /** Aviso de idioma gobernante, en el idioma de la página. */
  avisoIdioma: string;
};

// ─────────────────────────────────────────────────────────────────────────────
// EN — versión gobernante (§38)
// ─────────────────────────────────────────────────────────────────────────────

const EN: TermsDoc = {
  locale: "en",
  idioma: "English",
  title: "Terms and Conditions",
  actualizado: "August 17, 2026",
  avisoIdioma:
    "This is the governing English version of these Terms. A Spanish translation is available for convenience; if the two conflict, this version controls (Section 38).",
  intro: [
    "These Terms and Conditions (“Terms”) govern access to and use of the Enséñame Ya website, platform, services, features, and related technology (collectively, the “Platform”).",
    `The Platform is owned and operated by ${COMPANY.legalName}, a Florida limited liability company (“Ensename Ya,” “we,” “us,” or “our”).`,
    "By creating an account, accessing or using the Platform, booking or offering a class, or otherwise using our services, you acknowledge that you have read, understood, and agree to be bound by these Terms and any policies incorporated into them by reference.",
    "If you do not agree to these Terms, you may not use the Platform.",
  ],
  secciones: [
    {
      titulo: "1. About Enséñame Ya",
      bloques: [
        "Enséñame Ya is an online marketplace that connects individuals seeking live educational, instructional, creative, professional, or skill-based learning experiences (“Students”) with independent individuals who offer such services (“Tutors”).",
        "Ensename Ya provides the technology and marketplace infrastructure that facilitates discovery, scheduling, booking, payment, communication, and other functionality associated with these services.",
        { destacado: "Ensename Ya is not itself the provider of the classes offered by Tutors." },
        "Unless expressly stated otherwise, Tutors operate independently and are not employees, agents, partners, franchisees, or representatives of Ensename Ya. Tutors are responsible for the content, methodology, quality, accuracy, legality, and delivery of the services they offer.",
        "Ensename Ya may establish standards, eligibility requirements, verification procedures, marketplace rules, and quality-control measures without creating an employment, agency, partnership, or similar relationship with Tutors.",
      ],
    },
    {
      titulo: "2. Eligibility",
      bloques: [
        "The Platform is currently intended for individuals who are at least eighteen (18) years old and legally capable of entering into binding agreements.",
        "By creating an account or using the Platform, you represent and warrant that you satisfy these requirements.",
        "Ensename Ya reserves the right to modify eligibility requirements, introduce functionality for additional categories of users, or impose additional requirements at any time, subject to applicable law.",
      ],
    },
    {
      titulo: "2.1. Eligibility and Use by Minors",
      bloques: [
        "The Platform may be used by adults and, where permitted by Ensename Ya and applicable law, by minors for educational purposes under the authorization and supervision of a parent or legal guardian.",
        "Individuals who are eighteen (18) years of age or older and legally capable of entering into binding agreements may create and manage their own accounts.",
        "Individuals under eighteen (18) years of age may only use the Platform through an account, student profile, or other access mechanism authorized by Ensename Ya and with the consent of a parent or legal guardian where required.",
        "For younger users, including children under thirteen (13), Ensename Ya may require that the account be created and controlled exclusively by a parent or legal guardian, with the minor participating through a dependent student profile rather than an independent account.",
        "A parent or legal guardian who creates an account or authorizes a minor's use of the Platform represents that they have the legal authority to act on behalf of the minor and accepts these Terms, applicable policies, purchases, bookings, and other Platform activity undertaken for or on behalf of that minor.",
        "Ensename Ya may establish different registration, verification, consent, communication, privacy, payment, safety, or supervision requirements based on a user's age, location, applicable law, type of service, or other relevant circumstances.",
        "Ensename Ya may request proof of age, identity, parental authority, or consent where reasonably necessary and may restrict or suspend access where such requirements cannot be satisfactorily verified.",
        "The availability of the Platform to minors may vary by jurisdiction, and certain services, Tutors, features, or categories may be unavailable to minors.",
        "Nothing in these Terms is intended to limit rights or protections afforded to minors under applicable law.",
      ],
    },
    {
      titulo: "3. User Accounts",
      bloques: [
        "Certain Platform functionality may require the creation of an account.",
        "Users agree to provide accurate, complete, and current information and to maintain the confidentiality of their account credentials.",
        "Users are responsible for activity occurring through their accounts except to the extent prohibited by applicable law.",
        "Ensename Ya may request identity verification or additional information when reasonably necessary for security, payment processing, fraud prevention, regulatory compliance, marketplace integrity, or other legitimate business purposes.",
        "We may restrict, suspend, or terminate access to an account if we reasonably believe these Terms, applicable law, or Platform policies have been violated, or where necessary to protect users, Tutors, Ensename Ya, payment providers, or third parties.",
      ],
    },
    {
      titulo: "4. Tutor Verification",
      bloques: [
        "Ensename Ya may implement verification and onboarding procedures for Tutors, which may include identity verification, credential review, interviews, onboarding, demonstrations, documentation, or other procedures determined appropriate by Ensename Ya.",
        "Verification or approval of a Tutor does not constitute a guarantee, certification, endorsement, or warranty regarding that Tutor or the results of any class.",
        "Ensename Ya may modify its verification requirements, request additional verification, re-evaluate Tutors, suspend listings, or withdraw approval at its discretion, subject to applicable law.",
      ],
    },
    {
      titulo: "5. Tutor Listings and Services",
      bloques: [
        "Tutors determine the services they offer, subject to Platform rules and applicable law.",
        "Tutor listings may include information such as subject matter, qualifications, experience, teaching methodology, availability, class duration, pricing, and other relevant information.",
        "Tutors are responsible for ensuring that their listings and representations are truthful, accurate, current, and not misleading.",
        "Ensename Ya may review, modify, restrict, reject, suspend, or remove listings that violate these Terms, Platform policies, applicable law, quality standards, or other reasonable marketplace requirements.",
      ],
    },
    {
      titulo: "6. How Classes Are Purchased",
      bloques: [
        "Students may browse available Tutors and classes through the Platform.",
        "To purchase a class, a Student generally:",
        {
          ol: [
            "selects a Tutor or available class;",
            "reviews the Tutor's profile, class description, price, availability, and other applicable information;",
            "selects an available date and time;",
            "confirms the booking information;",
            "pays the amount displayed during checkout through the payment method made available on the Platform; and",
            "receives confirmation of the booking.",
          ],
        },
        "A booking becomes confirmed when the Platform indicates that the transaction and reservation have been successfully completed.",
        "Additional conditions may be disclosed before checkout and, where applicable, form part of the transaction.",
      ],
    },
    {
      titulo: "7. Live Online Classes",
      bloques: [
        "At the current stage of the Platform, classes are provided live and online.",
        "Classes are not pre-recorded courses unless expressly identified otherwise in the future.",
        "Ensename Ya may introduce additional service formats, including group classes, in-person experiences, recorded content, subscriptions, packages, or other learning formats. Additional or modified terms may apply to such services.",
      ],
    },
    {
      titulo: "8. Personalized Services and Assessment Sessions",
      bloques: [
        "Classes may be personalized based on the Student's objectives, skill level, needs, interests, or other information communicated to the Tutor.",
        "Ensename Ya may recommend that Students and Tutors participate in an introductory or assessment session before proceeding with additional instruction.",
        "Unless expressly stated otherwise, such assessment sessions are recommended but are not mandatory.",
        "The scope, methodology, and content of personalized instruction may vary between Tutors.",
      ],
    },
    {
      titulo: "9. Tutor Pricing",
      bloques: [
        "Tutors generally establish their own prices for services offered through the Platform, subject to any applicable Platform requirements, pricing parameters, promotional programs, or other conditions established by Ensename Ya.",
        "The price applicable to a transaction will be presented to the Student before purchase.",
        "Ensename Ya does not guarantee that Tutor prices will remain unchanged.",
      ],
    },
    {
      titulo: "10. Platform Fees and Commissions",
      bloques: [
        "Ensename Ya may charge Students, Tutors, or both fees associated with use of the Platform, including service fees, booking fees, commissions, processing-related charges, subscription fees, promotional fees, or other charges.",
        "Applicable charges will be disclosed as required before the relevant transaction or otherwise communicated through the Platform.",
        "Fees, commissions, pricing structures, promotional arrangements, and other commercial terms may change from time to time.",
        "Unless required by law or expressly stated otherwise, a change will apply prospectively and will not retroactively alter a completed transaction.",
      ],
    },
    {
      titulo: "11. Payments",
      bloques: [
        "Payments made through the Platform are processed using Ensename Ya's designated payment providers, which may include dLocal Go and other providers selected from time to time.",
        "By making or receiving a payment through the Platform, users authorize Ensename Ya and its payment service providers to process the transaction and take reasonably necessary actions related to payment authorization, settlement, refunds, fraud prevention, regulatory compliance, disputes, chargebacks, and related activities.",
        "Use of third-party payment services may also be subject to terms or policies imposed by those providers.",
        "Ensename Ya may add, remove, or replace payment providers or payment methods at its discretion.",
      ],
    },
    {
      titulo: "12. Tutor Payouts",
      bloques: [
        "Subject to these Terms and any applicable Tutor-specific agreement, payments owed to Tutors are generally processed no earlier than seven (7) days and ordinarily no later than fourteen (14) days following completion of the applicable class.",
        "This timeframe is an estimated ordinary processing window and is not an unconditional guarantee of settlement within a particular number of days.",
        "Ensename Ya may reasonably delay, hold, adjust, offset, reverse, or otherwise restrict a payout where necessary in connection with:",
        [
          "refunds or refund requests;",
          "payment disputes or chargebacks;",
          "suspected fraud or unauthorized activity;",
          "violations of Platform policies;",
          "complaints or investigations;",
          "identity or compliance verification;",
          "payment processor requirements or delays;",
          "technical or banking issues;",
          "amounts owed to Ensename Ya; or",
          "other legitimate legal, regulatory, risk-management, or operational reasons.",
        ],
        "Any such action remains subject to applicable law and applicable contractual obligations.",
      ],
    },
    {
      titulo: "13. Student Cancellations",
      bloques: [
        "Unless different terms are expressly disclosed before booking:",
        { destacado: "Cancellation at least 24 hours before the scheduled class:" },
        "The Student is generally eligible for a refund of 100% of the amount paid for the affected class.",
        { destacado: "Cancellation less than 24 hours before the scheduled class:" },
        "The Student is generally eligible for a refund of 50% of the amount paid for the affected class.",
        "Refunds may be returned to the original payment method, issued as Platform credit, or handled through another legally permissible method disclosed to the Student, subject to applicable law, payment-provider requirements, and the circumstances of the transaction.",
        "Ensename Ya may make reasonable exceptions to these rules where circumstances warrant, including emergencies, technical failures, suspected abuse, exceptional events, or other circumstances determined appropriate by Ensename Ya.",
        "Nothing in this section limits non-waivable consumer rights under applicable law.",
      ],
    },
    {
      titulo: "14. Rescheduling",
      bloques: [
        "Students and Tutors may generally request to reschedule a class at least twenty-four (24) hours before its scheduled start time.",
        "Rescheduling remains subject to Tutor availability, Platform functionality, and any applicable conditions displayed during the process.",
        "Requests made less than twenty-four (24) hours before the scheduled class may be denied or treated under the applicable cancellation policy unless Ensename Ya or the affected Tutor agrees otherwise where permitted.",
      ],
    },
    {
      titulo: "15. Tutor Cancellations",
      bloques: [
        "If a Tutor cancels a confirmed class, the Student will generally be entitled to a 100% refund for the affected class.",
        "A Tutor may offer to reschedule the class, but the Student is not required to accept the proposed replacement time.",
        "Ensename Ya may take additional action against Tutors who repeatedly cancel confirmed classes or otherwise fail to meet Platform standards.",
      ],
    },
    {
      titulo: "16. Tutor No-Shows",
      bloques: [
        "If a Tutor fails to attend a confirmed class without an accepted cancellation or other justification recognized by Ensename Ya, the Student will generally be entitled to a 100% refund for the affected class.",
        "Repeated Tutor no-shows may result in warnings, reduced Platform privileges, limitations, penalties, suspension, removal, or other corrective action.",
        "Three or more no-show incidents may trigger additional review or enforcement action. Ensename Ya retains reasonable discretion to determine the appropriate response based on the frequency, circumstances, severity, history, and available evidence relating to each incident.",
      ],
    },
    {
      titulo: "17. Student No-Shows",
      bloques: [
        "If a Student fails to attend a confirmed class and has not timely cancelled or rescheduled the class in accordance with these Terms, the Student will generally not be entitled to a refund.",
        "Subject to applicable fees, commissions, payment adjustments, disputes, or other legitimate deductions, the Tutor will generally remain entitled to the compensation that would otherwise be payable for the completed reservation.",
        "Ensename Ya may make exceptions where warranted by extraordinary circumstances or applicable law.",
      ],
    },
    {
      titulo: "18. Refunds and Disputes",
      bloques: [
        "If a Student reasonably believes that a class was not delivered, was materially different from its description, or otherwise failed to comply with applicable Platform requirements, the Student may submit a dispute to Ensename Ya.",
        "Ensename Ya may request information or evidence from the Student and Tutor and may investigate the circumstances.",
        "To the fullest extent permitted by applicable law, Ensename Ya will determine eligibility for refunds, credits, partial refunds, payment releases, or other remedies after considering the available information and applicable policies.",
        "Ensename Ya may establish reasonable deadlines and procedures for submitting disputes.",
        "Nothing in this section limits rights or remedies that cannot lawfully be waived.",
      ],
    },
    {
      titulo: "19. Tutor Independence",
      bloques: [
        "Tutors use the Platform as independent service providers.",
        "Unless otherwise expressly agreed in writing, Tutors:",
        [
          "determine whether and when to offer services;",
          "establish their availability;",
          "generally establish their own pricing;",
          "determine their instructional methodology and content;",
          "are responsible for fulfilling their legal, professional, licensing, tax, and regulatory obligations; and",
          "are not authorized to bind Ensename Ya or make commitments on its behalf.",
        ],
        "Nothing in these Terms creates an employment, partnership, joint venture, franchise, fiduciary, or agency relationship between Ensename Ya and a Tutor.",
        "Ensename Ya's marketplace standards, verification procedures, payment rules, quality requirements, or ability to enforce Platform policies do not by themselves create such a relationship.",
      ],
    },
    {
      titulo: "20. User Conduct",
      bloques: [
        "Users may not use the Platform to:",
        [
          "engage in unlawful, fraudulent, abusive, threatening, discriminatory, or deceptive conduct;",
          "impersonate another person;",
          "provide materially false or misleading information;",
          "infringe intellectual property or privacy rights;",
          "distribute malware or interfere with Platform security;",
          "misuse payment systems;",
          "manipulate reviews, transactions, or Platform functionality;",
          "harass other users;",
          "offer or request illegal services;",
          "circumvent Platform restrictions or enforcement measures; or",
          "engage in conduct that reasonably threatens the safety, integrity, reputation, or operation of the Platform or its users.",
        ],
        "Ensename Ya may investigate suspected violations and take reasonable corrective action.",
      ],
    },
    {
      titulo: "21. Circumvention and Off-Platform Transactions",
      bloques: [
        "Ensename Ya invests resources in connecting Students and Tutors and providing infrastructure supporting their transactions.",
        "Users may not use the Platform primarily to identify another user and then intentionally circumvent applicable Platform payment mechanisms, fees, commissions, or booking systems in violation of Platform rules.",
        "Ensename Ya may establish additional anti-circumvention rules, reasonable restricted periods, exceptions, or other requirements through Tutor agreements or Platform policies.",
        "Violations may result in account restrictions, suspension, termination, loss of Platform privileges, or other remedies permitted by law.",
      ],
    },
    {
      titulo: "22. Reviews and User Content",
      bloques: [
        "The Platform may allow users to submit reviews, profile information, images, descriptions, messages, or other content.",
        "Users retain ownership of their content but grant Ensename Ya a non-exclusive, worldwide, royalty-free license to host, reproduce, display, format, distribute, and otherwise use such content as reasonably necessary to operate, promote, secure, and improve the Platform.",
        "Users may not submit content that is unlawful, defamatory, fraudulent, infringing, abusive, or otherwise violates these Terms.",
        "Ensename Ya may moderate or remove content where reasonably appropriate.",
      ],
    },
    {
      titulo: "23. Intellectual Property",
      bloques: [
        "The Platform, including its software, design, branding, logos, interfaces, text, graphics, functionality, databases, and other proprietary materials, is owned by or licensed to Ensename Ya and is protected by applicable intellectual property laws.",
        "Except as expressly authorized, users may not copy, reproduce, modify, distribute, sell, license, reverse engineer, exploit, or create derivative works from Ensename Ya's proprietary Platform materials.",
        "Nothing in these Terms transfers ownership of Ensename Ya intellectual property to any user.",
      ],
    },
    {
      titulo: "24. Third-Party Services",
      bloques: [
        "The Platform may integrate or rely upon third-party services, including payment processors, communications technology, hosting providers, identity-verification providers, analytics providers, and other service providers.",
        "Ensename Ya does not control every aspect of third-party services and, to the extent permitted by law, is not responsible for interruptions, errors, acts, omissions, or failures attributable solely to independent third parties.",
      ],
    },
    {
      titulo: "25. Availability and Changes to the Platform",
      bloques: [
        "Ensename Ya may modify, improve, replace, suspend, restrict, or discontinue features or portions of the Platform from time to time.",
        "We do not guarantee uninterrupted or error-free availability.",
        "Where reasonably possible and appropriate, Ensename Ya may provide notice of material changes affecting users.",
      ],
    },
    {
      titulo: "26. No Guarantee of Educational or Professional Results",
      bloques: [
        "Ensename Ya does not guarantee any particular academic, professional, financial, artistic, athletic, linguistic, certification, employment, examination, or other result from use of the Platform or participation in a Tutor's services.",
        "Learning outcomes depend on numerous factors outside Ensename Ya's control.",
        "Tutor credentials or verification do not constitute a guarantee of results.",
      ],
    },
    {
      titulo: "27. Disclaimer of Warranties",
      bloques: [
        "TO THE FULLEST EXTENT PERMITTED BY APPLICABLE LAW, THE PLATFORM IS PROVIDED ON AN “AS IS” AND “AS AVAILABLE” BASIS.",
        "ENSENAME YA DISCLAIMS WARRANTIES NOT EXPRESSLY PROVIDED IN THESE TERMS, INCLUDING IMPLIED WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT, TO THE EXTENT SUCH WARRANTIES MAY LAWFULLY BE DISCLAIMED.",
        "Nothing in these Terms excludes warranties or consumer protections that cannot legally be excluded.",
      ],
    },
    {
      titulo: "28. Limitation of Liability",
      bloques: [
        "TO THE FULLEST EXTENT PERMITTED BY APPLICABLE LAW, ENSENAME YA SHALL NOT BE LIABLE FOR INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, PUNITIVE, OR CONSEQUENTIAL DAMAGES ARISING FROM OR RELATING TO USE OF THE PLATFORM, TRANSACTIONS BETWEEN USERS, OR SERVICES PROVIDED BY TUTORS.",
        "TO THE FULLEST EXTENT PERMITTED BY LAW, ENSENAME YA'S AGGREGATE LIABILITY ARISING FROM A PARTICULAR TRANSACTION OR EVENT SHALL BE LIMITED TO THE GREATER OF THE AMOUNT OF FEES ACTUALLY RECEIVED BY ENSENAME YA IN CONNECTION WITH THE TRANSACTION GIVING RISE TO THE CLAIM OR ANY MINIMUM AMOUNT OF LIABILITY REQUIRED BY APPLICABLE LAW.",
        "These limitations do not apply where liability cannot lawfully be excluded or limited.",
      ],
    },
    {
      titulo: "29. Indemnification",
      bloques: [
        `To the extent permitted by applicable law, users agree to indemnify and hold harmless ${COMPANY.legalName} and its officers, directors, members, employees, contractors, and agents from third-party claims, liabilities, losses, damages, and reasonable expenses arising from the user's material violation of these Terms, violation of applicable law, infringement of third-party rights, or services provided by that user through the Platform.`,
        "Any indemnification obligation is subject to applicable law.",
      ],
    },
    {
      titulo: "30. Suspension and Termination",
      bloques: [
        "Ensename Ya may suspend, restrict, or terminate accounts or Platform access where reasonably necessary because of:",
        [
          "violation of these Terms or Platform policies;",
          "fraud or suspected fraud;",
          "safety concerns;",
          "repeated cancellations or no-shows;",
          "payment disputes or abuse;",
          "unlawful conduct;",
          "regulatory or compliance requirements;",
          "threats to Platform integrity; or",
          "other material conduct reasonably determined to warrant such action.",
        ],
        "Where appropriate, Ensename Ya may provide notice or an opportunity to respond.",
        "Provisions that by their nature should survive termination will remain effective following termination.",
      ],
    },
    {
      titulo: "31. International Use",
      bloques: [
        "The Platform may be accessible to users in multiple countries.",
        "Users are responsible for complying with laws applicable to them and to the services they provide or purchase.",
        "The availability of the Platform in a particular country does not constitute a representation that every feature, Tutor service, payment method, or transaction is lawful or available in every jurisdiction.",
        "Ensename Ya may restrict countries, territories, users, services, payment methods, or functionality where reasonably necessary for legal, regulatory, sanctions, payment, security, risk-management, or operational reasons.",
        "Mandatory rights granted under applicable local consumer law remain unaffected to the extent they cannot legally be waived by contract.",
      ],
    },
    {
      titulo: "32. Taxes",
      bloques: [
        "Users are responsible for taxes, reporting requirements, registrations, or other governmental obligations applicable to their own activities, earnings, or purchases, except where Ensename Ya is legally required to collect, report, withhold, or remit amounts on their behalf.",
        "Ensename Ya may collect or withhold taxes or request tax-related information where required or reasonably necessary for compliance.",
      ],
    },
    {
      titulo: "33. Governing Law",
      bloques: [
        "These Terms shall be governed by and construed in accordance with the laws of the State of Florida, United States, without regard to conflict-of-law principles, except to the extent mandatory law in a user's jurisdiction requires otherwise.",
        "Subject to any applicable arbitration agreement, mandatory consumer-protection law, or other legally required forum, disputes arising from these Terms or the Platform shall be subject to the jurisdiction of competent courts in Florida.",
        "Ensename Ya reserves the right, to the extent permitted by law, to introduce or require a separate dispute-resolution or arbitration agreement for future transactions or continued Platform use, provided that any such agreement is appropriately disclosed and accepted as required by applicable law.",
      ],
    },
    {
      titulo: "34. Changes to These Terms",
      bloques: [
        "Ensename Ya may update these Terms from time to time to reflect changes in the Platform, business model, payment systems, legal requirements, policies, or operations.",
        "Material changes will be communicated as required by applicable law.",
        "The updated Terms will become effective on the date indicated in the revised version or upon another date properly communicated to users.",
        "Where legally required, users may be asked to affirmatively accept updated Terms.",
      ],
    },
    {
      titulo: "35. Severability",
      bloques: [
        "If any provision of these Terms is determined to be invalid, illegal, or unenforceable, that provision will be interpreted, modified, or severed to the extent legally permissible, and the remaining provisions will continue in effect.",
      ],
    },
    {
      titulo: "36. No Waiver",
      bloques: [
        "Failure by Ensename Ya to enforce any provision of these Terms does not constitute a waiver of its right to enforce that provision or any other provision later.",
      ],
    },
    {
      titulo: "37. Entire Agreement",
      bloques: [
        "These Terms, together with any policies, disclosures, Tutor agreements, transaction-specific conditions, or other documents expressly incorporated by reference, constitute the applicable agreement between the user and Ensename Ya concerning use of the Platform.",
        "If separate terms apply to a particular feature, transaction, or category of user, those specific terms may supplement these Terms.",
      ],
    },
    {
      titulo: "38. Language",
      bloques: [
        "These Terms may be made available in English, Spanish, and potentially other languages for user convenience.",
        "To the extent permitted by applicable law, if there is a conflict or inconsistency between the English version and a translated version, the English version will control.",
        "Nothing in this section limits language-related consumer rights that cannot lawfully be waived.",
      ],
    },
    {
      titulo: "39. Contact and Legal Information",
      bloques: [
        "The Platform is operated by:",
        { destacado: COMPANY.legalName },
        `${COMPANY.taxIdLabel}: ${COMPANY.taxId}`,
        COMPANY_ADDRESS_LINE,
        `Email: ${COMPANY.email}`,
        "Questions, complaints, disputes, or legal notices relating to these Terms may be submitted using the contact information above.",
      ],
    },
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// ES — traducción de cortesía. En caso de conflicto manda la inglesa (§38).
// ─────────────────────────────────────────────────────────────────────────────

const ES: TermsDoc = {
  locale: "es",
  idioma: "Español",
  title: "Términos y Condiciones",
  actualizado: "17 de agosto de 2026",
  avisoIdioma:
    "Esta es la traducción al español, disponible por comodidad. La versión que rige es la inglesa: si hay conflicto entre ambas, prevalece aquella (sección 38).",
  intro: [
    "Estos Términos y Condiciones (“Términos”) regulan el acceso y uso del sitio web, plataforma, servicios, funcionalidades y tecnología relacionada de Enséñame Ya (conjuntamente, la “Plataforma”).",
    `La Plataforma es propiedad de y está operada por ${COMPANY.legalName}, una compañía de responsabilidad limitada constituida en Florida (“Ensename Ya”, “nosotros”, “nos” o “nuestro”).`,
    "Al crear una cuenta, acceder o utilizar la Plataforma, reservar u ofrecer una clase, o utilizar nuestros servicios de cualquier otra forma, el usuario reconoce que ha leído, comprendido y acepta estos Términos y las políticas incorporadas a ellos por referencia.",
    "Si no acepta estos Términos, no deberá utilizar la Plataforma.",
  ],
  secciones: [
    {
      titulo: "1. Acerca de Enséñame Ya",
      bloques: [
        "Enséñame Ya es un marketplace o plataforma digital que conecta a personas interesadas en experiencias educativas, instructivas, creativas, profesionales o de aprendizaje de habilidades en vivo (“Alumnos”) con personas independientes que ofrecen dichos servicios (“Tutores”).",
        "Ensename Ya proporciona la tecnología e infraestructura del marketplace que facilita el descubrimiento, programación, reserva, pago, comunicación y otras funcionalidades relacionadas con dichos servicios.",
        { destacado: "Ensename Ya no es, por sí misma, la prestadora de las clases ofrecidas por los Tutores." },
        "Salvo que se indique expresamente lo contrario, los Tutores actúan de manera independiente y no son empleados, agentes, socios, franquiciados ni representantes de Ensename Ya. Cada Tutor es responsable del contenido, metodología, calidad, exactitud, legalidad y prestación de los servicios que ofrece.",
        "Ensename Ya podrá establecer estándares, requisitos de elegibilidad, procedimientos de verificación, reglas del marketplace y medidas de control de calidad sin que ello genere una relación laboral, de agencia, sociedad o similar con los Tutores.",
      ],
    },
    {
      titulo: "2. Elegibilidad",
      bloques: [
        "Actualmente, la Plataforma está destinada a personas de al menos dieciocho (18) años de edad y con capacidad legal para celebrar acuerdos vinculantes.",
        "Al crear una cuenta o utilizar la Plataforma, el usuario declara y garantiza que cumple con estos requisitos.",
        "Ensename Ya se reserva el derecho de modificar los requisitos de elegibilidad, incorporar funcionalidades para categorías adicionales de usuarios o establecer requisitos adicionales en cualquier momento, sujeto a la legislación aplicable.",
      ],
    },
    {
      titulo: "2.1. Elegibilidad y Uso por Menores de Edad",
      bloques: [
        "La Plataforma podrá ser utilizada por adultos y, cuando Ensename Ya y la legislación aplicable lo permitan, por menores de edad con fines educativos bajo la autorización y supervisión de un padre, madre o representante legal.",
        "Las personas de dieciocho (18) años de edad o más que tengan capacidad legal para celebrar acuerdos vinculantes podrán crear y administrar sus propias cuentas.",
        "Las personas menores de dieciocho (18) años únicamente podrán utilizar la Plataforma mediante una cuenta, perfil de estudiante u otro mecanismo de acceso autorizado por Ensename Ya y con el consentimiento de un padre, madre o representante legal cuando corresponda.",
        "Para usuarios de menor edad, incluyendo niños menores de trece (13) años, Ensename Ya podrá exigir que la cuenta sea creada y controlada exclusivamente por un padre, madre o representante legal, y que el menor participe mediante un perfil de estudiante dependiente en lugar de una cuenta independiente.",
        "El padre, madre o representante legal que cree una cuenta o autorice el uso de la Plataforma por parte de un menor declara que posee la autoridad legal necesaria para actuar en representación del menor y acepta estos Términos, las políticas aplicables, compras, reservas y demás actividades realizadas en la Plataforma para o en nombre de dicho menor.",
        "Ensename Ya podrá establecer distintos requisitos de registro, verificación, consentimiento, comunicación, privacidad, pago, seguridad o supervisión dependiendo de la edad del usuario, su ubicación, la legislación aplicable, el tipo de servicio u otras circunstancias relevantes.",
        "Ensename Ya podrá solicitar comprobantes de edad, identidad, autoridad parental o consentimiento cuando resulte razonablemente necesario y podrá restringir o suspender el acceso cuando dichos requisitos no puedan verificarse satisfactoriamente.",
        "La disponibilidad de la Plataforma para menores podrá variar según la jurisdicción, y determinados servicios, Tutores, funcionalidades o categorías podrán no estar disponibles para menores de edad.",
        "Nada de estos Términos pretende limitar los derechos o protecciones otorgados a menores por la legislación aplicable.",
      ],
    },
    {
      titulo: "3. Cuentas de Usuario",
      bloques: [
        "Determinadas funcionalidades de la Plataforma podrán requerir la creación de una cuenta.",
        "Los usuarios se comprometen a proporcionar información exacta, completa y actualizada, y a mantener la confidencialidad de las credenciales de acceso a su cuenta.",
        "Los usuarios son responsables de la actividad realizada a través de sus cuentas, salvo en la medida en que la legislación aplicable disponga lo contrario.",
        "Ensename Ya podrá solicitar verificación de identidad o información adicional cuando resulte razonablemente necesario por motivos de seguridad, procesamiento de pagos, prevención de fraude, cumplimiento normativo, integridad del marketplace u otros fines comerciales legítimos.",
        "Podremos restringir, suspender o cancelar el acceso a una cuenta cuando consideremos razonablemente que se han infringido estos Términos, la legislación aplicable o las políticas de la Plataforma, o cuando sea necesario para proteger a usuarios, Tutores, Ensename Ya, proveedores de pago o terceros.",
      ],
    },
    {
      titulo: "4. Verificación de Tutores",
      bloques: [
        "Ensename Ya podrá implementar procedimientos de verificación e incorporación de Tutores que podrán incluir verificación de identidad, revisión de credenciales, entrevistas, procesos de onboarding, demostraciones, documentación u otros procedimientos que Ensename Ya considere apropiados.",
        "La verificación o aprobación de un Tutor no constituye una garantía, certificación, recomendación ni promesa respecto del Tutor o de los resultados de una clase.",
        "Ensename Ya podrá modificar sus requisitos de verificación, solicitar verificaciones adicionales, reevaluar Tutores, suspender publicaciones o retirar aprobaciones a su discreción, sujeto a la legislación aplicable.",
      ],
    },
    {
      titulo: "5. Publicaciones y Servicios de los Tutores",
      bloques: [
        "Los Tutores determinan los servicios que ofrecen, sujetos a las reglas de la Plataforma y a la legislación aplicable.",
        "Los perfiles o publicaciones de los Tutores podrán incluir información como materia o especialidad, cualificaciones, experiencia, metodología de enseñanza, disponibilidad, duración de las clases, precios y otra información relevante.",
        "Los Tutores son responsables de garantizar que sus publicaciones y declaraciones sean veraces, exactas, actuales y no engañosas.",
        "Ensename Ya podrá revisar, modificar, restringir, rechazar, suspender o eliminar publicaciones que incumplan estos Términos, las políticas de la Plataforma, la legislación aplicable, los estándares de calidad u otros requisitos razonables del marketplace.",
      ],
    },
    {
      titulo: "6. Cómo se Contratan las Clases",
      bloques: [
        "Los Alumnos podrán explorar los Tutores y clases disponibles a través de la Plataforma.",
        "Para contratar una clase, el Alumno generalmente:",
        {
          ol: [
            "selecciona un Tutor o una clase disponible;",
            "revisa el perfil del Tutor, descripción de la clase, precio, disponibilidad y demás información aplicable;",
            "selecciona una fecha y hora disponibles;",
            "confirma la información de la reserva;",
            "paga el importe mostrado durante el proceso de compra mediante el método de pago disponible en la Plataforma; y",
            "recibe la confirmación de la reserva.",
          ],
        },
        "Una reserva se considerará confirmada cuando la Plataforma indique que la transacción y la reserva se han completado correctamente.",
        "Podrán mostrarse condiciones adicionales antes de finalizar la compra y, cuando corresponda, dichas condiciones formarán parte de la transacción.",
      ],
    },
    {
      titulo: "7. Clases Online en Vivo",
      bloques: [
        "En la etapa actual de la Plataforma, las clases se ofrecen en vivo y de forma online.",
        "Las clases no son cursos pregrabados, salvo que en el futuro se identifique expresamente un servicio de esa naturaleza.",
        "Ensename Ya podrá incorporar otros formatos de servicio, incluyendo clases grupales, experiencias presenciales, contenido grabado, suscripciones, paquetes u otros formatos de aprendizaje. Dichos servicios podrán estar sujetos a términos adicionales o modificados.",
      ],
    },
    {
      titulo: "8. Servicios Personalizados y Sesiones de Evaluación",
      bloques: [
        "Las clases podrán personalizarse de acuerdo con los objetivos, nivel, necesidades, intereses u otra información comunicada por el Alumno al Tutor.",
        "Ensename Ya podrá recomendar que Alumnos y Tutores participen en una sesión introductoria o de evaluación antes de continuar con clases adicionales.",
        "Salvo que se indique expresamente lo contrario, dichas sesiones de evaluación son recomendadas, pero no obligatorias.",
        "El alcance, metodología y contenido de la enseñanza personalizada podrá variar entre Tutores.",
      ],
    },
    {
      titulo: "9. Precios de los Tutores",
      bloques: [
        "Los Tutores generalmente establecen sus propios precios para los servicios ofrecidos a través de la Plataforma, sujetos a los requisitos aplicables, parámetros de precios, programas promocionales u otras condiciones que Ensename Ya pueda establecer.",
        "El precio aplicable a una transacción será presentado al Alumno antes de la compra.",
        "Ensename Ya no garantiza que los precios establecidos por los Tutores permanezcan sin cambios.",
      ],
    },
    {
      titulo: "10. Tarifas y Comisiones de la Plataforma",
      bloques: [
        "Ensename Ya podrá cobrar a Alumnos, Tutores o ambos tarifas asociadas con el uso de la Plataforma, incluyendo tarifas de servicio, cargos por reserva, comisiones, cargos relacionados con procesamiento, suscripciones, tarifas promocionales u otros cargos.",
        "Los cargos aplicables serán informados según corresponda antes de la transacción correspondiente o comunicados de otra forma a través de la Plataforma.",
        "Las tarifas, comisiones, estructuras de precios, acuerdos promocionales y demás condiciones comerciales podrán cambiar periódicamente.",
        "Salvo que la legislación aplicable exija lo contrario o se indique expresamente, los cambios se aplicarán de forma prospectiva y no modificarán retroactivamente una transacción ya completada.",
      ],
    },
    {
      titulo: "11. Pagos",
      bloques: [
        "Los pagos realizados a través de la Plataforma serán procesados mediante los proveedores de pago designados por Ensename Ya, que podrán incluir dLocal Go y otros proveedores seleccionados periódicamente.",
        "Al realizar o recibir un pago mediante la Plataforma, los usuarios autorizan a Ensename Ya y a sus proveedores de servicios de pago a procesar la transacción y realizar las acciones razonablemente necesarias relacionadas con autorización, liquidación, reembolsos, prevención de fraude, cumplimiento normativo, disputas, contracargos y actividades relacionadas.",
        "El uso de servicios de pago de terceros también podrá estar sujeto a los términos o políticas establecidos por dichos proveedores.",
        "Ensename Ya podrá incorporar, eliminar o sustituir proveedores o métodos de pago a su discreción.",
      ],
    },
    {
      titulo: "12. Pagos a Tutores",
      bloques: [
        "Sujeto a estos Términos y a cualquier acuerdo específico aplicable a los Tutores, los pagos adeudados a los Tutores generalmente se procesarán no antes de siete (7) días y, ordinariamente, no después de catorce (14) días después de completarse la clase correspondiente.",
        "Este período constituye un plazo ordinario estimado de procesamiento y no representa una garantía incondicional de liquidación dentro de un número determinado de días.",
        "Ensename Ya podrá razonablemente retrasar, retener, ajustar, compensar, revertir o restringir un pago cuando resulte necesario en relación con:",
        [
          "reembolsos o solicitudes de reembolso;",
          "disputas de pago o contracargos;",
          "sospechas de fraude o actividad no autorizada;",
          "incumplimientos de las políticas de la Plataforma;",
          "reclamaciones o investigaciones;",
          "verificaciones de identidad o cumplimiento;",
          "requisitos o retrasos de proveedores de pago;",
          "problemas técnicos o bancarios;",
          "cantidades adeudadas a Ensename Ya; u",
          "otras razones legítimas de carácter legal, regulatorio, operativo o de gestión de riesgos.",
        ],
        "Cualquier medida de este tipo estará sujeta a la legislación aplicable y a las obligaciones contractuales correspondientes.",
      ],
    },
    {
      titulo: "13. Cancelaciones por Parte del Alumno",
      bloques: [
        "Salvo que se comuniquen condiciones diferentes expresamente antes de realizar la reserva:",
        { destacado: "Cancelación con al menos 24 horas de anticipación:" },
        "El Alumno generalmente tendrá derecho al reembolso del 100% del importe pagado por la clase afectada.",
        { destacado: "Cancelación con menos de 24 horas de anticipación:" },
        "El Alumno generalmente tendrá derecho al reembolso del 50% del importe pagado por la clase afectada.",
        "Los reembolsos podrán realizarse al método de pago original, emitirse como crédito dentro de la Plataforma o gestionarse mediante otro método legalmente permitido y comunicado al Alumno, sujeto a la legislación aplicable, los requisitos del proveedor de pagos y las circunstancias de la transacción.",
        "Ensename Ya podrá realizar excepciones razonables a estas reglas cuando las circunstancias lo justifiquen, incluyendo emergencias, fallas técnicas, sospecha de abuso, eventos excepcionales u otras circunstancias que Ensename Ya considere apropiadas.",
        "Nada de lo establecido en esta sección limita los derechos irrenunciables del consumidor reconocidos por la legislación aplicable.",
      ],
    },
    {
      titulo: "14. Reprogramación",
      bloques: [
        "Los Alumnos y Tutores generalmente podrán solicitar la reprogramación de una clase con al menos veinticuatro (24) horas de anticipación respecto de la hora programada de inicio.",
        "La reprogramación estará sujeta a la disponibilidad del Tutor, las funcionalidades de la Plataforma y cualquier condición aplicable mostrada durante el proceso.",
        "Las solicitudes realizadas con menos de veinticuatro (24) horas de anticipación podrán ser rechazadas o gestionadas de conformidad con la política de cancelación aplicable, salvo que Ensename Ya o el Tutor afectado acuerden lo contrario cuando sea permitido.",
      ],
    },
    {
      titulo: "15. Cancelaciones por Parte del Tutor",
      bloques: [
        "Si un Tutor cancela una clase confirmada, el Alumno generalmente tendrá derecho al reembolso del 100% correspondiente a la clase afectada.",
        "El Tutor podrá ofrecer la reprogramación de la clase, pero el Alumno no estará obligado a aceptar la nueva fecha u horario propuesto.",
        "Ensename Ya podrá adoptar medidas adicionales respecto de Tutores que cancelen repetidamente clases confirmadas o que incumplan los estándares de la Plataforma.",
      ],
    },
    {
      titulo: "16. Inasistencia del Tutor",
      bloques: [
        "Si un Tutor no asiste a una clase confirmada sin una cancelación aceptada u otra justificación reconocida por Ensename Ya, el Alumno generalmente tendrá derecho al reembolso del 100% correspondiente a la clase afectada.",
        "Las inasistencias reiteradas de un Tutor podrán resultar en advertencias, reducción de privilegios dentro de la Plataforma, limitaciones, penalizaciones, suspensión, eliminación de la Plataforma u otras medidas correctivas.",
        "Tres o más incidentes de inasistencia podrán dar lugar a una revisión o medidas adicionales. Ensename Ya mantendrá una discreción razonable para determinar la respuesta correspondiente según la frecuencia, circunstancias, gravedad, historial y evidencia disponible de cada caso.",
      ],
    },
    {
      titulo: "17. Inasistencia del Alumno",
      bloques: [
        "Si un Alumno no asiste a una clase confirmada y no ha cancelado o reprogramado oportunamente de acuerdo con estos Términos, generalmente no tendrá derecho a un reembolso.",
        "Sujeto a las tarifas, comisiones, ajustes de pago, disputas u otras deducciones legítimas aplicables, el Tutor generalmente mantendrá el derecho a recibir la compensación que de otro modo le correspondería por la reserva completada.",
        "Ensename Ya podrá realizar excepciones cuando existan circunstancias extraordinarias o cuando así lo exija la legislación aplicable.",
      ],
    },
    {
      titulo: "18. Reembolsos y Disputas",
      bloques: [
        "Si un Alumno considera razonablemente que una clase no fue impartida, fue sustancialmente diferente a lo anunciado o incumplió de otra manera los requisitos aplicables de la Plataforma, podrá presentar una disputa ante Ensename Ya.",
        "Ensename Ya podrá solicitar información o evidencia al Alumno y al Tutor e investigar las circunstancias.",
        "En la máxima medida permitida por la legislación aplicable, Ensename Ya determinará la procedencia de reembolsos, créditos, reembolsos parciales, liberación de pagos u otras soluciones después de considerar la información disponible y las políticas aplicables.",
        "Ensename Ya podrá establecer plazos y procedimientos razonables para la presentación de disputas.",
        "Nada de lo establecido en esta sección limita derechos o recursos legales que no puedan ser válidamente renunciados.",
      ],
    },
    {
      titulo: "19. Independencia de los Tutores",
      bloques: [
        "Los Tutores utilizan la Plataforma como prestadores independientes de servicios.",
        "Salvo acuerdo escrito expreso en contrario, los Tutores:",
        [
          "determinan si desean ofrecer servicios y cuándo hacerlo;",
          "establecen su disponibilidad;",
          "generalmente establecen sus propios precios;",
          "determinan su metodología y contenido de enseñanza;",
          "son responsables de cumplir sus obligaciones legales, profesionales, fiscales, regulatorias y de licenciamiento; y",
          "no están autorizados a obligar contractualmente a Ensename Ya ni asumir compromisos en su nombre.",
        ],
        "Nada de estos Términos crea una relación laboral, sociedad, joint venture, franquicia, relación fiduciaria o de agencia entre Ensename Ya y un Tutor.",
        "Los estándares del marketplace, procedimientos de verificación, reglas de pago, requisitos de calidad o capacidad de Ensename Ya para hacer cumplir las políticas de la Plataforma no crean por sí mismos dicha relación.",
      ],
    },
    {
      titulo: "20. Conducta de los Usuarios",
      bloques: [
        "Los usuarios no podrán utilizar la Plataforma para:",
        [
          "realizar actividades ilegales, fraudulentas, abusivas, amenazantes, discriminatorias o engañosas;",
          "hacerse pasar por otra persona;",
          "proporcionar información sustancialmente falsa o engañosa;",
          "infringir derechos de propiedad intelectual o privacidad;",
          "distribuir malware o interferir con la seguridad de la Plataforma;",
          "utilizar indebidamente los sistemas de pago;",
          "manipular reseñas, transacciones o funcionalidades;",
          "acosar a otros usuarios;",
          "ofrecer o solicitar servicios ilegales;",
          "evadir restricciones o medidas de cumplimiento de la Plataforma; o",
          "realizar conductas que razonablemente amenacen la seguridad, integridad, reputación u operación de la Plataforma o de sus usuarios.",
        ],
        "Ensename Ya podrá investigar posibles incumplimientos y adoptar medidas correctivas razonables.",
      ],
    },
    {
      titulo: "21. Evasión de la Plataforma y Transacciones Externas",
      bloques: [
        "Ensename Ya invierte recursos en conectar Alumnos y Tutores y proporcionar infraestructura para facilitar sus transacciones.",
        "Los usuarios no podrán utilizar la Plataforma principalmente para identificar a otro usuario y posteriormente evadir intencionalmente los mecanismos de pago, tarifas, comisiones o sistemas de reserva aplicables de la Plataforma en incumplimiento de sus reglas.",
        "Ensename Ya podrá establecer reglas adicionales contra la evasión, períodos razonables de restricción, excepciones u otros requisitos mediante acuerdos con Tutores o políticas de la Plataforma.",
        "Los incumplimientos podrán dar lugar a restricciones de cuenta, suspensión, terminación, pérdida de privilegios u otros recursos permitidos por la ley.",
      ],
    },
    {
      titulo: "22. Reseñas y Contenido de Usuarios",
      bloques: [
        "La Plataforma podrá permitir que los usuarios publiquen reseñas, información de perfil, imágenes, descripciones, mensajes u otro contenido.",
        "Los usuarios conservan la propiedad de su contenido, pero conceden a Ensename Ya una licencia no exclusiva, mundial y libre de regalías para alojar, reproducir, mostrar, formatear, distribuir y utilizar dicho contenido en la medida razonablemente necesaria para operar, promocionar, proteger y mejorar la Plataforma.",
        "Los usuarios no podrán publicar contenido ilegal, difamatorio, fraudulento, infractor, abusivo o que de otra manera incumpla estos Términos.",
        "Ensename Ya podrá moderar o eliminar contenido cuando resulte razonablemente apropiado.",
      ],
    },
    {
      titulo: "23. Propiedad Intelectual",
      bloques: [
        "La Plataforma, incluyendo su software, diseño, marca, logotipos, interfaces, textos, gráficos, funcionalidades, bases de datos y demás materiales propios, pertenece a Ensename Ya o ha sido debidamente licenciada y se encuentra protegida por la legislación aplicable de propiedad intelectual.",
        "Salvo autorización expresa, los usuarios no podrán copiar, reproducir, modificar, distribuir, vender, licenciar, realizar ingeniería inversa, explotar ni crear obras derivadas a partir de materiales propios de la Plataforma.",
        "Nada de estos Términos transfiere al usuario la propiedad de la propiedad intelectual de Ensename Ya.",
      ],
    },
    {
      titulo: "24. Servicios de Terceros",
      bloques: [
        "La Plataforma podrá integrar o depender de servicios proporcionados por terceros, incluyendo procesadores de pago, tecnología de comunicaciones, proveedores de hosting, servicios de verificación de identidad, analítica y otros proveedores.",
        "Ensename Ya no controla todos los aspectos de los servicios de terceros y, en la medida permitida por la ley, no será responsable por interrupciones, errores, actos, omisiones o fallas atribuibles exclusivamente a terceros independientes.",
      ],
    },
    {
      titulo: "25. Disponibilidad y Modificaciones de la Plataforma",
      bloques: [
        "Ensename Ya podrá modificar, mejorar, sustituir, suspender, restringir o descontinuar funcionalidades o partes de la Plataforma periódicamente.",
        "No garantizamos disponibilidad ininterrumpida ni libre de errores.",
        "Cuando sea razonablemente posible y apropiado, Ensename Ya podrá comunicar cambios importantes que afecten a los usuarios.",
      ],
    },
    {
      titulo: "26. Ausencia de Garantía de Resultados Educativos o Profesionales",
      bloques: [
        "Ensename Ya no garantiza ningún resultado académico, profesional, económico, artístico, deportivo, lingüístico, de certificación, empleo, examen u otro resultado particular derivado del uso de la Plataforma o de la participación en los servicios de un Tutor.",
        "Los resultados del aprendizaje dependen de numerosos factores fuera del control de Ensename Ya.",
        "Las credenciales o verificaciones de los Tutores no constituyen garantía de resultados.",
      ],
    },
    {
      titulo: "27. Exclusión de Garantías",
      bloques: [
        "EN LA MÁXIMA MEDIDA PERMITIDA POR LA LEGISLACIÓN APLICABLE, LA PLATAFORMA SE PROPORCIONA “TAL CUAL” Y “SEGÚN DISPONIBILIDAD”.",
        "ENSENAME YA EXCLUYE LAS GARANTÍAS QUE NO HAYAN SIDO EXPRESAMENTE ESTABLECIDAS EN ESTOS TÉRMINOS, INCLUYENDO, EN LA MEDIDA EN QUE PUEDAN SER LEGALMENTE EXCLUIDAS, GARANTÍAS IMPLÍCITAS DE COMERCIABILIDAD, IDONEIDAD PARA UN FIN PARTICULAR Y NO INFRACCIÓN.",
        "Nada de estos Términos excluye garantías o protecciones al consumidor que legalmente no puedan ser excluidas.",
      ],
    },
    {
      titulo: "28. Limitación de Responsabilidad",
      bloques: [
        "EN LA MÁXIMA MEDIDA PERMITIDA POR LA LEGISLACIÓN APLICABLE, ENSENAME YA NO SERÁ RESPONSABLE POR DAÑOS INDIRECTOS, INCIDENTALES, ESPECIALES, EJEMPLARES, PUNITIVOS O CONSECUENTES DERIVADOS O RELACIONADOS CON EL USO DE LA PLATAFORMA, TRANSACCIONES ENTRE USUARIOS O SERVICIOS PRESTADOS POR TUTORES.",
        "EN LA MÁXIMA MEDIDA PERMITIDA POR LA LEY, LA RESPONSABILIDAD TOTAL DE ENSENAME YA DERIVADA DE UNA TRANSACCIÓN O EVENTO PARTICULAR ESTARÁ LIMITADA AL MAYOR ENTRE EL IMPORTE DE LAS TARIFAS EFECTIVAMENTE RECIBIDAS POR ENSENAME YA EN RELACIÓN CON LA TRANSACCIÓN QUE ORIGINE LA RECLAMACIÓN Y CUALQUIER IMPORTE MÍNIMO DE RESPONSABILIDAD EXIGIDO POR LA LEGISLACIÓN APLICABLE.",
        "Estas limitaciones no se aplicarán cuando una responsabilidad no pueda ser legalmente excluida o limitada.",
      ],
    },
    {
      titulo: "29. Indemnización",
      bloques: [
        `En la medida permitida por la legislación aplicable, los usuarios aceptan indemnizar y mantener indemne a ${COMPANY.legalName}, así como a sus directivos, miembros, empleados, contratistas y agentes, frente a reclamaciones de terceros, responsabilidades, pérdidas, daños y gastos razonables derivados del incumplimiento sustancial de estos Términos por parte del usuario, el incumplimiento de la legislación aplicable, la infracción de derechos de terceros o los servicios prestados por dicho usuario mediante la Plataforma.`,
        "Cualquier obligación de indemnización estará sujeta a la legislación aplicable.",
      ],
    },
    {
      titulo: "30. Suspensión y Terminación",
      bloques: [
        "Ensename Ya podrá suspender, restringir o terminar cuentas o el acceso a la Plataforma cuando resulte razonablemente necesario debido a:",
        [
          "incumplimiento de estos Términos o políticas;",
          "fraude o sospecha de fraude;",
          "riesgos de seguridad;",
          "cancelaciones o inasistencias reiteradas;",
          "disputas o abuso de pagos;",
          "conductas ilegales;",
          "requisitos regulatorios o de cumplimiento;",
          "amenazas a la integridad de la Plataforma; u",
          "otras conductas sustanciales que razonablemente justifiquen dichas medidas.",
        ],
        "Cuando corresponda, Ensename Ya podrá proporcionar aviso u oportunidad de respuesta.",
        "Las disposiciones que por su naturaleza deban continuar vigentes después de la terminación permanecerán en vigor.",
      ],
    },
    {
      titulo: "31. Uso Internacional",
      bloques: [
        "La Plataforma podrá estar disponible para usuarios de múltiples países.",
        "Los usuarios son responsables de cumplir las leyes aplicables a ellos y a los servicios que presten o contraten.",
        "La disponibilidad de la Plataforma en un determinado país no constituye una declaración de que todas sus funcionalidades, servicios de Tutores, métodos de pago o transacciones sean legales o estén disponibles en todas las jurisdicciones.",
        "Ensename Ya podrá restringir países, territorios, usuarios, servicios, métodos de pago o funcionalidades cuando resulte razonablemente necesario por motivos legales, regulatorios, de sanciones, pagos, seguridad, gestión de riesgos u operación.",
        "Los derechos obligatorios reconocidos por la legislación local de protección al consumidor permanecerán vigentes en la medida en que no puedan ser legalmente renunciados.",
      ],
    },
    {
      titulo: "32. Impuestos",
      bloques: [
        "Los usuarios son responsables de los impuestos, obligaciones informativas, registros u otras obligaciones gubernamentales aplicables a sus propias actividades, ingresos o compras, salvo cuando Ensename Ya tenga la obligación legal de recaudar, declarar, retener o remitir cantidades en su nombre.",
        "Ensename Ya podrá recaudar o retener impuestos o solicitar información fiscal cuando sea requerido o razonablemente necesario para cumplir con obligaciones legales.",
      ],
    },
    {
      titulo: "33. Ley Aplicable",
      bloques: [
        "Estos Términos se regirán e interpretarán de conformidad con las leyes del Estado de Florida, Estados Unidos, sin considerar sus normas sobre conflicto de leyes, excepto cuando las normas imperativas de la jurisdicción del usuario exijan lo contrario.",
        "Sujeto a cualquier acuerdo de arbitraje aplicable, legislación obligatoria de protección al consumidor u otro foro legalmente requerido, las disputas derivadas de estos Términos o de la Plataforma estarán sujetas a la jurisdicción de los tribunales competentes de Florida.",
        "Ensename Ya se reserva el derecho, en la medida permitida por la ley, de introducir o requerir un acuerdo separado de resolución de disputas o arbitraje para futuras transacciones o para el uso continuado de la Plataforma, siempre que dicho acuerdo sea debidamente comunicado y aceptado conforme a la legislación aplicable.",
      ],
    },
    {
      titulo: "34. Modificaciones de Estos Términos",
      bloques: [
        "Ensename Ya podrá actualizar estos Términos periódicamente para reflejar cambios en la Plataforma, modelo de negocio, sistemas de pago, requisitos legales, políticas u operaciones.",
        "Los cambios sustanciales serán comunicados según lo exija la legislación aplicable.",
        "Los Términos actualizados entrarán en vigor en la fecha indicada en la versión revisada o en otra fecha debidamente comunicada a los usuarios.",
        "Cuando sea legalmente necesario, podrá solicitarse a los usuarios que acepten expresamente los Términos actualizados.",
      ],
    },
    {
      titulo: "35. Divisibilidad",
      bloques: [
        "Si alguna disposición de estos Términos fuera declarada inválida, ilegal o inaplicable, dicha disposición será interpretada, modificada o separada en la medida legalmente permitida, y las demás disposiciones continuarán plenamente vigentes.",
      ],
    },
    {
      titulo: "36. No Renuncia",
      bloques: [
        "El hecho de que Ensename Ya no exija el cumplimiento de alguna disposición de estos Términos no constituirá una renuncia a su derecho de exigir posteriormente dicha disposición o cualquier otra.",
      ],
    },
    {
      titulo: "37. Acuerdo Completo",
      bloques: [
        "Estos Términos, conjuntamente con las políticas, avisos, acuerdos de Tutores, condiciones específicas de transacciones u otros documentos expresamente incorporados por referencia, constituyen el acuerdo aplicable entre el usuario y Ensename Ya respecto del uso de la Plataforma.",
        "Cuando existan términos separados aplicables a una funcionalidad, transacción o categoría particular de usuario, dichos términos específicos podrán complementar estos Términos.",
      ],
    },
    {
      titulo: "38. Idioma",
      bloques: [
        "Estos Términos podrán estar disponibles en inglés, español y potencialmente otros idiomas para conveniencia de los usuarios.",
        "En la medida permitida por la legislación aplicable, en caso de conflicto o inconsistencia entre la versión en inglés y una versión traducida, prevalecerá la versión en inglés.",
        "Nada de esta sección limita derechos del consumidor relacionados con el idioma que no puedan ser legalmente renunciados.",
      ],
    },
    {
      titulo: "39. Contacto e Información Legal",
      bloques: [
        "La Plataforma es operada por:",
        { destacado: COMPANY.legalName },
        `${COMPANY.taxIdLabel}: ${COMPANY.taxId}`,
        COMPANY_ADDRESS_LINE,
        `Correo electrónico: ${COMPANY.email}`,
        "Las preguntas, reclamaciones, disputas o notificaciones legales relacionadas con estos Términos podrán enviarse utilizando la información de contacto indicada anteriormente.",
      ],
    },
  ],
};

export const TERMS_LOCALES = ["en", "es"] as const;
export type TermsLocale = (typeof TERMS_LOCALES)[number];

export const TERMS: Record<TermsLocale, TermsDoc> = { en: EN, es: ES };

/** La versión gobernante (§38). Es la que enlaza la casilla del registro. */
export const TERMS_GOVERNING_LOCALE: TermsLocale = "en";
