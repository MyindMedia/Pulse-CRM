import {defineConfig} from 'vitest/config';
export default defineConfig({css:{postcss:{plugins:[]}},resolve:{preserveSymlinks:true},test:{environment:'node',include:['convex/pulseWalkthrough/*.test.ts'],server:{deps:{inline:['convex-test']}}}});
