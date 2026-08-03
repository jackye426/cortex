/**
 * Fixed five-family map for index 01 (scan / encephalon).
 *
 * Families are named after brain functions that are also literally true of the
 * work they hold, and anchored to the anatomical node positions the client shell
 * already draws (`brainNodes` in the frontend's dataverse-brain).
 *
 * The map is deliberately fixed rather than clustered: it stays legible as the
 * vault grows. Topics the patterns miss fall back to the family their session
 * co-occurs with, and `unclassifiedTopics` counts drift so the map can be edited
 * when it stops fitting.
 */

export type ScanFamilyId =
  | "broadcast"
  | "motor"
  | "executive"
  | "default_mode"
  | "autonomic";

export interface ScanFamily {
  id: ScanFamilyId;
  /** Node label drawn on the volume. */
  label: string;
  /** Compact code for the header split readout. */
  short: string;
  /** Plain-language second line so the evocative name stays readable. */
  gloss: string;
  /** Anatomical anchor — matches the client shell's brainNodes coordinates. */
  anchor: { x: number; y: number; z: number };
  /** Position of this family's label in the annotation array (anchor order). */
  anchorIndex: number;
}

/**
 * Anchor order must match the client's `brainNodes`:
 * 0 frontal · 1 fissure · 2 occipital · 3 cerebellum · 4 temporal · 5 stem.
 * Index 3 (cerebellum) is reserved for the live hot-topic readout.
 */
export const SCAN_FAMILIES: ScanFamily[] = [
  {
    id: "executive",
    label: "EXECUTIVE",
    short: "EXEC",
    gloss: "VENTURE·LEGAL·STRUCTURE",
    anchor: { x: 0.86, y: 0.3, z: 0.3 },
    anchorIndex: 0,
  },
  {
    id: "default_mode",
    label: "DEFAULT MODE",
    short: "DMN",
    gloss: "ART·PHILOSOPHY·HISTORY",
    anchor: { x: 0.05, y: 0.78, z: 0.06 },
    anchorIndex: 1,
  },
  {
    id: "motor",
    label: "MOTOR",
    short: "MOTOR",
    gloss: "BUILD·PERF·UI",
    anchor: { x: -0.82, y: 0.28, z: -0.3 },
    anchorIndex: 2,
  },
  {
    id: "broadcast",
    label: "BROADCAST",
    short: "BCAST",
    gloss: "COPY·SEO·OUTREACH",
    anchor: { x: 0.3, y: -0.42, z: 0.62 },
    anchorIndex: 4,
  },
  {
    id: "autonomic",
    label: "AUTONOMIC",
    short: "AUTO",
    gloss: "TRAVEL·FOOD·ADMIN",
    anchor: { x: -0.44, y: -1.02, z: 0 },
    anchorIndex: 5,
  },
];

/** Index reserved for the dominant-topic readout. */
export const HOT_TOPIC_ANCHOR_INDEX = 3;

export const FAMILY_BY_ID = new Map(SCAN_FAMILIES.map((f) => [f.id, f]));

/**
 * Patterns are matched against the topic slug as substrings/regex, first match
 * wins in family order below. Verified against the live vault: 191/202 topics
 * and 94.9% of topic instances classify before fallback.
 */
const PATTERNS: Array<{ id: ScanFamilyId; patterns: RegExp[] }> = [
  {
    id: "executive",
    patterns: [
      /companies-house/, /contractor/, /corporate-structuring/, /delaware/, /gdpr/,
      /ip-protection/, /share-transfer/, /tax-efficiency/, /uk-ltd/, /vesting/,
      /co-founder/, /product-pivot/, /service-scope/, /farewell/, /collaboration/,
      /leadership/, /practitioner-ownership/, /team-management/, /solo-practitioner/,
      /clinic-operations/, /clinic-management/, /insurance/, /^healthcare$/,
      /uk-healthcare/, /us-healthcare/, /zocdoc/, /practitioner-network/,
      /practitioner-concerns/, /vietnamese-contractors/,
    ],
  },
  {
    id: "default_mode",
    patterns: [
      /^art-/, /japanese-aesthetic/, /british-politics/, /historical/, /world-war/,
      /war-and-conflict/, /psychological-warfare/, /hero-worship/, /human-emotions/,
      /^books$/, /environmental-activism/, /interactive-document/, /game-development/,
      /web2-5/, /^web3$/, /ai-and-blockchain/, /online-courses/, /learning-resources/,
      /^recommendations$/, /design-thinking/, /apple-design/,
    ],
  },
  {
    id: "autonomic",
    patterns: [
      /travel/, /train-tickets/, /holidays/, /cooking/, /cuisine/, /food/,
      /event-hosting/, /networking/, /^scheduling$/, /calendar-scheduling/,
    ],
  },
  {
    id: "motor",
    patterns: [
      /performance/, /^css/, /javascript/, /script/, /image/, /lazy/, /preload/,
      /responsive/, /core-web-vitals/, /largest-contentful/, /render/, /webpage/,
      /squarespace/, /platform-design/, /^healthcare-platform$/, /healthcare-software/,
      /platform-development/, /booking-system/, /booking-form/, /practitioner-portal/,
      /dashboard/, /multi-role/, /secure-messaging/, /practice-management/,
      /appointment/, /waitlist/, /ui-design/, /^html/, /form-behavior/,
      /user-experience/, /hero-banner/, /file-conversion/, /workflow-integration/,
      /calendar-integration/, /gmail-attachment/, /clinic-listing/, /docmap-integration/,
      /synaptic-care/, /sitemap/, /manual-reindex/, /one-pager-design/, /feature-listing/,
      /^docmap$/, /product-feedback/, /dietician-website/, /practitioner-booking/,
    ],
  },
  {
    id: "broadcast",
    patterns: [
      /copywrit/, /copy-editing/, /copy$/, /email/, /marketing/, /seo/, /keyword/,
      /meta-description/, /a-b-testing/, /click-through/, /open-rate/, /subject-line/,
      /outreach/, /recruitment/, /acquisition/, /value-proposition/, /messaging/,
      /tone-and-voice/, /cta/, /call-to-action/, /^content-/, /blogging/, /brochure/,
      /bullet-points/, /homepage-copy/, /profile/, /bios/, /trust-building/,
      /objection/, /pricing-model/, /roi-communication/, /status-signaling/,
      /exclusivity/, /personalization/, /client-communication/, /follow-up/, /sales/,
      /^patient-/, /practitioner-marketing/, /dietitian/, /psychology-services/,
      /psychologist/, /target-audience/, /google-search-console/, /ai-in-search/,
      /service-launch/, /platform-credibility/, /curiosity/, /conversational-tone/,
      /sample-size/, /mission-driven/, /london-based-practitioners/, /online-services/,
      /customer-relationship-management/, /practitioner-onboarding/,
    ],
  },
];

/** Calendar summaries carry no topics — classify them by title. */
const CALENDAR_PATTERNS: Array<{ id: ScanFamilyId; patterns: RegExp[] }> = [
  {
    id: "default_mode",
    patterns: [
      /opening reception/i, /book launch/i, /artist/i, /in-conversation/i,
      /gallery/i, /sound night/i, /exhibition/i, /hales/i, /alma pearl/i,
      /new art projects/i, /maximillian william/i,
    ],
  },
  {
    id: "executive",
    patterns: [
      /docmap/i, /forma/i, /^vc:/i, /investor/i, /podcast/i, /interview/i,
      /entrepreneurship/i, /meeting with/i, /chat$/i, /clinic/i, /harmony/i,
      /fertility/i, /\bsom\b/i, /msk lab/i,
    ],
  },
  {
    id: "autonomic",
    patterns: [/^appt/i, /servicing/i, /endo event/i, /^video$/i, /dentist/i, /gp\b/i],
  },
];

export function classifyTopic(topic: string): ScanFamilyId | null {
  const t = topic.toLowerCase().trim();
  for (const group of PATTERNS) {
    for (const re of group.patterns) {
      if (re.test(t)) return group.id;
    }
  }
  return null;
}

export function classifyCalendarSummary(summary: string | null): ScanFamilyId | null {
  if (!summary) return null;
  for (const group of CALENDAR_PATTERNS) {
    for (const re of group.patterns) {
      if (re.test(summary)) return group.id;
    }
  }
  return null;
}

export interface FamilyAssignment {
  /** topic slug → family, including co-occurrence fallbacks. */
  topicFamily: Map<string, ScanFamilyId>;
  /** Topics no pattern matched and no session context could place. */
  unclassifiedTopics: string[];
}

/**
 * Resolve every topic to a family. Unmatched topics inherit the dominant family
 * of the sessions they appear in; a topic that never co-occurs with a classified
 * topic stays unclassified and is reported in meta.
 */
export function assignTopicFamilies(
  sessionTopics: Array<string[]>,
): FamilyAssignment {
  const topicFamily = new Map<string, ScanFamilyId>();
  const unresolved = new Set<string>();

  for (const topics of sessionTopics) {
    for (const topic of topics) {
      if (topicFamily.has(topic)) continue;
      const direct = classifyTopic(topic);
      if (direct) topicFamily.set(topic, direct);
      else unresolved.add(topic);
    }
  }

  // Co-occurrence fallback: adopt the dominant family of co-occurring topics.
  for (const topic of [...unresolved]) {
    const votes = new Map<ScanFamilyId, number>();
    for (const topics of sessionTopics) {
      if (!topics.includes(topic)) continue;
      for (const other of topics) {
        const fam = topicFamily.get(other);
        if (fam) votes.set(fam, (votes.get(fam) ?? 0) + 1);
      }
    }
    let best: ScanFamilyId | null = null;
    let bestN = 0;
    for (const [fam, n] of votes) {
      if (n > bestN) {
        best = fam;
        bestN = n;
      }
    }
    if (best) {
      topicFamily.set(topic, best);
      unresolved.delete(topic);
    }
  }

  return { topicFamily, unclassifiedTopics: [...unresolved] };
}
