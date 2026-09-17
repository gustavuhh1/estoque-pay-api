import { defineConfig } from "tsup"

export default defineConfig({
  entry: ["src/server.ts"],
  format: ["esm"],
  platform: "node",
  target: "node24",
  outDir: "dist",
  tsconfig: "./tsconfig.json",
  clean: true,
  sourcemap: true,
  splitting: false,
  dts: false,
})
