import { defineConfig } from 'vitest/config';

export default defineConfig({
  define: { __STORE_BUILD__: 'false', __VERSION__: '"test"' }
});
