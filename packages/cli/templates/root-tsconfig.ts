export const ROOT_TSCONFIG_TEMPLATE = {
  compilerOptions: {
    target: 'ES2017',
    lib: ['dom', 'dom.iterable', 'esnext'],
    allowJs: true,
    skipLibCheck: true,
    strict: true,
    noEmit: true,
    esModuleInterop: true,
    module: 'esnext',
    moduleResolution: 'bundler',
    resolveJsonModule: true,
    isolatedModules: true,
    jsx: 'react-jsx',
    incremental: true,
    paths: {
      '#/monorise/*': ['./.monorise/*'],
    },
  },
  include: ['**/*.ts', '**/*.tsx'],
  exclude: ['node_modules', 'sst.config.ts'],
};
