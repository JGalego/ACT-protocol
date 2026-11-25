// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import mermaid from 'astro-mermaid';

// https://astro.build/config
export default defineConfig({
  site: 'https://act-protocol.org',
  integrations: [
    // Must run before the starlight integration so its markdown
    // transform sees ```mermaid fences before Starlight processes them.
    mermaid({
      theme: 'neutral',
      autoTheme: true,
    }),
    starlight({
      title: 'ACT Protocol',
      description: 'An open protocol for recording the provenance of work by people and AI.',
      logo: {
        light: './src/assets/logo-light.svg',
        dark: './src/assets/logo-dark.svg',
      },
      customCss: ['./src/styles/landing.css'],
      components: {
        Hero: './src/components/Hero.astro',
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
            {
              label: 'Live Explorer',
              link: '/explorer/',
              badge: { text: 'Live', variant: 'success' },
              attrs: { target: '_blank', rel: 'noopener' },
            },
          ],
        },
        {
          label: 'Guides',
          items: [
            { label: 'Examples', slug: 'examples' },
            { label: 'SDKs', slug: 'sdks' },
            { label: 'Deployment', slug: 'deployment' },
          ],
        },
        {
          label: 'Reference',
          items: [
            {
              label: 'Specification',
              collapsed: true,
              items: [
                { label: 'Overview', slug: 'specification' },
                { label: 'ACT 1.0', slug: 'specification/act-1-0' },
                { label: 'Semantic Model', slug: 'specification/semantic-model' },
                { label: 'State Machines', slug: 'specification/state-machines' },
                { label: 'Federation', slug: 'specification/federation' },
                { label: 'Conformance', slug: 'specification/conformance' },
              ],
            },
            { label: 'API Reference', slug: 'api-reference' },
            { label: 'Design Decisions', slug: 'design-decisions' },
            { label: 'Roadmap', slug: 'roadmap' },
          ],
        },
      ],
    }),
  ],
});
