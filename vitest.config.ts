import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // 判定と型のテストは、ブラウザもDOMも要らない。
    // domain/ と io/ が React から独立していることの裏返しでもある。
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
