import next from 'eslint-config-next';

const config = [
  ...next,
  { ignores: ['.next/**', 'node_modules/**', 'public/sw.js', 'test-results/**'] },
];
export default config;
