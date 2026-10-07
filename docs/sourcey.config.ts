import { defineConfig, markdown } from 'sourcey'

export default defineConfig({
  name: 'persistence-drizzle',
  siteUrl: 'https://jonbogaty.com',
  baseUrl: '/persistence-drizzle',
  theme: {
    preset: 'default',
    colors: {
      primary: '#1d4e5f',
      light: '#3a8da6',
      dark: '#0e2630',
    },
    fonts: {
      sans: 'system-ui, sans-serif',
      mono: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    },
    layout: {
      sidebar: '17rem',
      toc: '18rem',
      content: '46rem',
    },
    css: ['./brand.css'],
  },
  favicon: './assets/favicon.svg',
  repo: 'https://github.com/jbcom/persistence-drizzle',
  editBranch: 'main',
  editBasePath: 'docs',
  prettyUrls: 'slash',
  navbar: {
    links: [
      { type: 'github', href: 'https://github.com/jbcom/persistence-drizzle' },
      { type: 'npm', href: 'https://www.npmjs.com/package/persistence-drizzle' },
    ],
  },
  footer: {
    links: [
      {
        type: 'link',
        label: 'MIT License',
        href: 'https://github.com/jbcom/persistence-drizzle/blob/main/LICENSE',
      },
      {
        type: 'link',
        label: 'Security',
        href: 'https://github.com/jbcom/persistence-drizzle/security/policy',
      },
    ],
  },
  navigation: {
    tabs: [
      {
        tab: 'Documentation',
        slug: '',
        source: markdown({
          groups: [
            {
              group: 'Getting Started',
              pages: ['introduction', 'getting-started'],
            },
            {
              group: 'Guides',
              pages: ['migrations', 'transactions', 'capacitor', 'preferences-and-envelopes'],
            },
            {
              group: 'Reference',
              pages: ['API', 'ARCHITECTURE'],
            },
            {
              group: 'Project',
              pages: ['decisions', 'contributing', 'release-history'],
            },
          ],
        }),
      },
    ],
  },
})
