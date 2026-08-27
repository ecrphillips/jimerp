import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    // Every file spins up its own jsdom, and the suite runs more files than
    // the machine has cores. Under that contention the slowest jsdom tests
    // took over ten times their solo runtime and blew the 5s default, failing
    // for want of a scheduler rather than for anything they assert. A suite
    // that fails at random teaches people to re-run it instead of read it.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
