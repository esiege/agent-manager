// What kind of work an agent did, for the Reporting tab. An agent can say (`agentctl story
// --type`); otherwise the words of its story, prompt and finished work decide, and failing that
// its kind. Sorting happens when the report is read, so changing a rule here re-sorts history.

import type { AgentKind, WorkType } from './contract';

export type WorkGroup = 'technical' | 'non-technical' | 'other';

export const WORK_TYPE_INFO: Record<WorkType, { label: string; group: WorkGroup }> = {
  feature: { label: 'Feature development', group: 'technical' },
  bugfix: { label: 'Bug fixing', group: 'technical' },
  testing: { label: 'Testing', group: 'technical' },
  refactor: { label: 'Refactoring', group: 'technical' },
  infra: { label: 'Infrastructure & DevOps', group: 'technical' },
  docs: { label: 'Documentation', group: 'technical' },
  'level-design': { label: 'Level design', group: 'non-technical' },
  'game-design': { label: 'Game design', group: 'non-technical' },
  writing: { label: 'Writing & narrative', group: 'non-technical' },
  art: { label: 'Art & audio', group: 'non-technical' },
  community: { label: 'Marketing & community', group: 'non-technical' },
  planning: { label: 'Planning & research', group: 'non-technical' },
  other: { label: 'Other', group: 'other' },
};

export const WORK_GROUP_LABEL: Record<WorkGroup, string> = {
  technical: 'Technical',
  'non-technical': 'Non-technical',
  other: 'Other',
};

/**
 * First match wins. Non-technical rules use whole phrases: the products here are often about
 * games and stories, so a word like "quest" or "novel" names a feature as often as the work.
 */
const RULES: [WorkType, RegExp][] = [
  ['level-design', /\blevel[- ]?design|\blevel layouts?\b|\b(?:grey|gray)box|\bblockout\b|\bencounter design|\bmap design|\btilemaps?\b/i],
  ['game-design', /\bgame[- ]?design|\bgame balance|\bbalanc(?:e|ing) pass|\bplaytest|\bgame mechanics?\b|\bcore loop\b|\bgdd\b/i],
  ['writing', /\bdialog(?:ue)? (?:pass|writing|draft)|\bwrit(?:e|ing) (?:the )?(?:lore|dialog(?:ue)?|story|chapter|script)|\bnarrative design|\bcopy ?writing|\bproofread/i],
  ['art', /\bconcept art|\bsprites? sheet|\b(?:sound|audio) design|\btextur(?:e|ing) pass|\billustrat(?:e|ion)s?\b/i],
  ['community', /\bpatch notes\b|\bmarketing\b|\bcommunity\b|\bsocial media\b|\bnewsletter\b|\bpress (?:kit|release)|\bdiscord (?:post|announcement)|\bannouncement\b/i],
  ['planning', /\broadmap\b|\bplanning\b|\bspec(?:ification)? (?:doc|draft)|\bresearch\b|\bcompetitive analysis|\bbrainstorm/i],
  ['testing', /\btests?\b|\btesting\b|\bvitest\b|\bjest\b|\bplaywright\b|\bcypress\b|\be2e\b|\bcoverage\b|\bunit[- ]tests?|\bqa\b/i],
  ['bugfix', /\bfix(?:es|ed|ing)?\b|\bbugs?\b|\bcrash(?:es|ing)?\b|\bregression\b|\bdebug(?:ging)?\b|\bbroken\b|\bhotfix\b/i],
  ['infra', /\bdeploy(?:s|ed|ing|ment)?\b|\binfra(?:structure)?\b|\bbicep\b|\bterraform\b|\bci\b|\bpipelines?\b|\bdocker\b|\bkubernetes\b|\bazure\b|\bgithub actions\b|\brelease build\b/i],
  ['refactor', /\brefactor(?:s|ed|ing)?\b|\bclean ?up\b|\btech(?:nical)? debt\b|\bsimplif(?:y|ied|ies)\b|\brenam(?:e|ed|ing)\b|\bmigrat(?:e|ion)\b/i],
  ['docs', /\bdocs?\b|\bdocumentation\b|\breadme\b|\bchangelog\b|\brunbook\b/i],
];

export type WorkTypeSource = 'agent' | 'words' | 'kind';

export interface WorkTypeInput {
  /** What the agent said, if it did. */
  declared: WorkType | null | undefined;
  kind: AgentKind;
  /** Story, prompt, titles of finished work: whatever describes the work, most telling first. */
  texts: (string | null | undefined)[];
}

/** The kind of work, and how it was decided (so the UI can say which ones were guessed). */
export function workType({ declared, kind, texts }: WorkTypeInput): { type: WorkType; source: WorkTypeSource } {
  if (declared) return { type: declared, source: 'agent' };
  for (const text of texts) {
    if (!text) continue;
    for (const [type, rule] of RULES) if (rule.test(text)) return { type, source: 'words' };
  }
  // Claude Code works in a code base; OpenClaw personas run community channels (instructions.md).
  if (kind === 'claude-code') return { type: 'feature', source: 'kind' };
  if (kind === 'openclaw') return { type: 'community', source: 'kind' };
  return { type: 'other', source: 'kind' };
}
