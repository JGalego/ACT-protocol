// Renders the normative spec on the website without keeping a second copy.
//
// spec/*.md at the repo root is the single source of truth. This script turns
// each file into a Starlight page under src/content/docs/specification/ (which
// is gitignored) by adding frontmatter, dropping the leading H1 (Starlight
// renders the title itself), and linking cross-references between documents.
// It runs before `astro dev` and `astro build`.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const outDir = join(root, 'apps', 'website', 'src', 'content', 'docs', 'specification');
const repo = 'https://github.com/JGalego/ACT-protocol';

/** source file -> served slug under /specification/ */
const pages = [
  {
    src: 'ACT-1.0.md',
    slug: 'act-1-0',
    label: 'ACT 1.0',
    description:
      'The normative ACT 1.0 specification: identities, canonicalization, events, ledger, transformations, approvals, policy, federation, and conformance.',
  },
  {
    src: 'semantic-model.md',
    slug: 'semantic-model',
    label: 'Semantic Model',
    description: 'The entities ACT 1.0 references and the relations between them.',
  },
  {
    src: 'state-machines.md',
    slug: 'state-machines',
    label: 'State Machines',
    description: 'Every ACT lifecycle expressed as an explicit state machine.',
  },
  {
    src: 'federation.md',
    slug: 'federation',
    label: 'Federation',
    description: 'Peer-to-peer federation between independently operated ACT ledgers.',
  },
  {
    src: 'conformance.md',
    slug: 'conformance',
    label: 'Conformance',
    description: 'The ACT conformance profiles and the fixtures a claimant must pass.',
  },
];

const slugBySource = new Map(pages.map((p) => [`spec/${p.src}`, `/specification/${p.slug}/`]));

/** Link `spec/x.md` mentions to the rendered page, leaving code fences alone. */
function linkCrossReferences(markdown) {
  let inFence = false;
  return markdown
    .split('\n')
    .map((line) => {
      if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
      if (inFence) return line;
      return line.replace(/`(spec\/[A-Za-z0-9.-]+\.md)`/g, (whole, path) => {
        const href = slugBySource.get(path);
        return href ? `[\`${path}\`](${href})` : whole;
      });
    })
    .join('\n');
}

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

pages.forEach((page, index) => {
  const raw = readFileSync(join(root, 'spec', page.src), 'utf8');
  const heading = raw.match(/^# (.+)\n+/);
  if (!heading) throw new Error(`spec/${page.src} must start with an H1 title`);
  const body = linkCrossReferences(raw.slice(heading[0].length));
  const frontmatter = [
    '---',
    `title: ${JSON.stringify(heading[1])}`,
    `description: ${JSON.stringify(page.description)}`,
    `editUrl: ${repo}/edit/main/spec/${page.src}`,
    'sidebar:',
    `  label: ${JSON.stringify(page.label)}`,
    `  order: ${index + 1}`,
    '---',
    '',
    `<!-- Generated from spec/${page.src} by scripts/sync-spec.mjs. Do not edit. -->`,
    '',
  ].join('\n');
  writeFileSync(join(outDir, `${page.slug}.md`), frontmatter + body);
});

console.log(`sync-spec: wrote ${pages.length} pages to ${outDir}`);
