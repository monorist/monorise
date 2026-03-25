import { defineConfig } from 'vitepress';

export default defineConfig({
  title: 'Monorise',
  description:
    'DynamoDB single-table toolkit with type-safe, event-driven architecture',
  base: '/',

  head: [
    ['link', { rel: 'icon', href: '/logo.png' }],
    [
      'style',
      {},
      `@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');`,
    ],
  ],

  themeConfig: {
    logo: '/logo.png',

    nav: [
      { text: 'Guide', link: '/getting-started' },
      { text: 'Concepts', link: '/concepts/' },
      { text: 'React SDK', link: '/react' },
      { text: 'Roadmap', link: '/roadmap' },
    ],

    sidebar: [
      {
        text: 'Getting Started',
        items: [
          { text: 'Introduction', link: '/getting-started' },
          { text: 'Deploying', link: '/deploying' },
        ],
      },
      {
        text: 'Core Concepts',
        items: [
          { text: 'Design Philosophy', link: '/concepts/' },
          { text: 'Entities', link: '/concepts/entities' },
          { text: 'Mutuals', link: '/concepts/mutuals' },
          { text: 'Tags', link: '/concepts/tags' },
          { text: 'Prejoins', link: '/concepts/prejoins' },
        ],
      },
      {
        text: 'Architecture',
        items: [
          { text: 'Overview & API', link: '/architecture' },
          { text: 'Custom Routes', link: '/custom-routes' },
        ],
      },
      {
        text: 'Best Practices',
        items: [{ text: 'Best Practices', link: '/best-practices' }],
      },
      {
        text: 'SDKs & Packages',
        items: [
          { text: 'Package Map', link: '/packages' },
          { text: 'React SDK', link: '/react' },
          { text: 'SST SDK', link: '/sst' },
        ],
      },
      {
        text: 'Community',
        items: [
          { text: 'FAQ', link: '/faq' },
          { text: 'Roadmap', link: '/roadmap' },
          { text: 'Contributing', link: '/contributing' },
        ],
      },
    ],

    outline: [2, 3],

    socialLinks: [
      { icon: 'github', link: 'https://github.com/monorist/monorise' },
      { icon: 'discord', link: 'https://discord.gg/9c3ccQkvGj' },
    ],

    editLink: {
      pattern:
        'https://github.com/monorist/monorise/edit/main/www/docs/:path',
      text: 'Edit this page on GitHub',
    },

    search: {
      provider: 'local',
    },

    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright 2024-present Monorise Contributors',
    },
  },
});
