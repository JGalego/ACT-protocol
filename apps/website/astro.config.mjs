// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import mermaid from 'astro-mermaid';

// https://astro.build/config
export default defineConfig({
  site: 'https://jgalego.github.io',
  base: '/ACT-protocol',
  integrations: [
    // Must run before the starlight integration so its markdown
    // transform sees ```mermaid fences before Starlight processes them.
    mermaid({
      theme: 'neutral',
      autoTheme: true,
    }),
    starlight({
      title: 'ACT Protocol',
      description:
        'An open protocol for preserving meaning, provenance, evidence, and accountable decisions across human and AI collaboration.',
      logo: {
        src: './src/assets/logo.svg',
      },
      social: [
        { icon: 'github', label: 'GitHub', href: 'https://github.com/JGalego/ACT-protocol' },
      ],
      editLink: {
        baseUrl: 'https://github.com/JGalego/ACT-protocol/edit/main/apps/website/',
      },
      sidebar: [
        {
          label: 'Start Here',
          items: [
            { label: 'Getting Started', slug: 'getting-started' },
            { label: 'Architecture', slug: 'architecture' },
          ],
        },
        {
          label: 'Reference',
          items: [
            { label: 'Specification', slug: 'specification' },
            { label: 'API Reference', slug: 'api-reference' },
            { label: 'Roadmap', slug: 'roadmap' },
          ],
        },
      ],
    }),
  ],
});
