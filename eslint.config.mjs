import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import boundaries from "eslint-plugin-boundaries";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Legacy CDN-based source — reference only, not part of the Next.js app
    "_legacy_backup/**",
    "js/**",
    // Claude Code agent worktrees — already gitignored; ephemeral sandbox
    // copies of the repo that contain stale imports.
    ".claude/worktrees/**",
  ]),
  // ── Architecture boundaries (Phase 2.7) ──────────────────────────────
  // Encodes the import-direction rules from RESTRUCTURE_PLAN.md Section
  // D.3 / E.1 in machine-checkable form. Plan's snippet was authored
  // against eslint-plugin-boundaries v5 (`boundaries/element-types`); v6
  // moved the rule to `boundaries/dependencies` with a selector-shaped
  // schema. Semantics are unchanged — same allow-graph as the plan.
  {
    plugins: { boundaries },
    settings: {
      // Element type definitions. Order matters when patterns nest
      // (the more-specific pattern must be earlier in the array so a
      // file that matches both lands on the deeper element type). The
      // platform pattern uses a single-wildcard so each individual
      // platform folder (refm/, bvm/, ...) is its own platform element.
      "boundaries/elements": [
        { type: "platform", pattern: "src/hubs/modeling/platforms/*", mode: "folder" },
        { type: "core",     pattern: "src/core",                       mode: "folder" },
        { type: "shared",   pattern: "src/shared",                     mode: "folder" },
        { type: "main",     pattern: "src/hubs/main",                  mode: "folder" },
        { type: "training", pattern: "src/hubs/training",              mode: "folder" },
        { type: "modeling", pattern: "src/hubs/modeling",              mode: "folder" },
        { type: "feature",  pattern: "src/features/*",                 mode: "folder" },
        { type: "integ",    pattern: "src/integrations/*",             mode: "folder" },
        { type: "app",      pattern: "app",                            mode: "folder" },
      ],
    },
    rules: {
      "boundaries/dependencies": ["error", {
        default: "disallow",
        rules: [
          { from: { type: "core" },     allow: { to: { type: ["core"] } } },
          { from: { type: "shared" },   allow: { to: { type: ["core", "shared", "integ"] } } },
          { from: { type: "main" },     allow: { to: { type: ["core", "shared", "integ", "main"] } } },
          { from: { type: "training" }, allow: { to: { type: ["core", "shared", "integ", "training"] } } },
          { from: { type: "modeling" }, allow: { to: { type: ["core", "shared", "integ", "modeling"] } } },
          { from: { type: "platform" }, allow: { to: { type: ["core", "shared", "integ", "modeling", "platform"] } } },
          { from: { type: "feature" },  allow: { to: { type: ["core", "shared", "integ", "feature"] } } },
          { from: { type: "integ" },    allow: { to: { type: ["core", "shared"] } } },
          // App routes are allowed to import any internal element. They
          // are the only place where cross-hub composition is legitimate
          // (e.g. /portal renders the platform list; /sitemap aggregates).
          // `app` is included so route files can co-locate their own
          // helper components (page.tsx + Component.tsx in the same dir).
          { from: { type: "app" },      allow: { to: { type: ["app", "core", "shared", "main", "training", "modeling", "platform", "feature", "integ"] } } },
        ],
      }],
    },
  },
]);

export default eslintConfig;
