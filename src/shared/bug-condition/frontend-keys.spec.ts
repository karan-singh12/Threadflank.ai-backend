/**
 * Bug Condition Exploration Test
 *
 * Validates: Requirements 1.1, 3.1, 3.2
 *
 * This test MUST FAIL on unfixed code — failure confirms the bug exists.
 *
 * Bug condition:
 *   - Frontend source files under `frontend/src/` directly read provider API
 *     keys from `process.env` and call third-party AI provider URLs.
 *   - `twin.service.ts` contains an inline `callAiGeneration()` fallback chain
 *     that should live exclusively in the backend ImageProviderService.
 *
 * Expected failures on unfixed code:
 *   - frontend/src/app/api/tryon/route.ts    — reads REPLICATE_API_TOKEN, fetches api.replicate.com
 *   - frontend/src/lib/server/image-engine.ts — reads all four provider keys
 *   - frontend/src/lib/server/replicate.ts    — reads REPLICATE_API_TOKEN
 *   - backend/src/modules/twin/twin.service.ts — contains callAiGeneration()
 */

import * as fs from "fs";
import * as path from "path";

// ─── Paths ────────────────────────────────────────────────────────────────────

// backend/src/shared/bug-condition/ -> go up 4 levels -> repo root -> frontend/src
const FRONTEND_SRC = path.resolve(__dirname, "../../../../frontend/src");
const TWIN_SERVICE = path.resolve(
    __dirname,
    "../../modules/twin/twin.service.ts"
);

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Recursively collect all .ts / .tsx files under a directory. */
function collectTsFiles(dir: string): string[] {
    const results: string[] = [];
    if (!fs.existsSync(dir)) return results;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            results.push(...collectTsFiles(full));
        } else if (entry.isFile() && /\.(tsx?)$/.test(entry.name)) {
            results.push(full);
        }
    }
    return results;
}

// ─── Forbidden patterns ───────────────────────────────────────────────────────

const FORBIDDEN_ENV_READS = [
    "process.env.REPLICATE_API_TOKEN",
    "process.env.GEMINI_API_KEY",
    "process.env.OPENAI_API_KEY",
    "process.env.OPENROUTER_API_KEY",
];

const FORBIDDEN_FETCH_HOSTS = [
    "api.replicate.com",
    "generativelanguage.googleapis.com",
    "api.openai.com",
    "openrouter.ai",
];

// ─── Test suite ───────────────────────────────────────────────────────────────

describe("Bug Condition: Provider keys and AI fetches must not exist in frontend", () => {
    let frontendFiles: string[];

    beforeAll(() => {
        frontendFiles = collectTsFiles(FRONTEND_SRC);
        // Safety check: if no files are found the test would vacuously pass — fail fast.
        expect(frontendFiles.length).toBeGreaterThan(0);
    });

    test("No frontend file reads a provider API key from process.env", () => {
        const violations: string[] = [];

        for (const filePath of frontendFiles) {
            const content = fs.readFileSync(filePath, "utf8");
            const relPath = path.relative(
                path.resolve(__dirname, "../../../.."),
                filePath
            );

            for (const pattern of FORBIDDEN_ENV_READS) {
                if (content.includes(pattern)) {
                    violations.push(`  [${pattern}]  ->  ${relPath}`);
                }
            }
        }

        if (violations.length > 0) {
            throw new Error(
                `Found ${violations.length} frontend file(s) that read provider API keys from process.env:\n\n` +
                violations.join("\n") +
                "\n\nThese keys must only be read in the NestJS backend (ImageProviderService)."
            );
        }
    });

    test("No frontend file makes a direct fetch to a third-party AI provider URL", () => {
        const violations: string[] = [];

        for (const filePath of frontendFiles) {
            const content = fs.readFileSync(filePath, "utf8");
            const relPath = path.relative(
                path.resolve(__dirname, "../../../.."),
                filePath
            );

            for (const host of FORBIDDEN_FETCH_HOSTS) {
                if (content.includes(host)) {
                    violations.push(`  [${host}]  ->  ${relPath}`);
                }
            }
        }

        if (violations.length > 0) {
            throw new Error(
                `Found ${violations.length} frontend file(s) that fetch directly to AI provider URLs:\n\n` +
                violations.join("\n") +
                "\n\nAll AI provider calls must be proxied through the NestJS backend."
            );
        }
    });
});

describe("Bug Condition: twin.service.ts must not contain callAiGeneration()", () => {
    test("twin.service.ts does not define callAiGeneration", () => {
        expect(fs.existsSync(TWIN_SERVICE)).toBe(true);

        const content = fs.readFileSync(TWIN_SERVICE, "utf8");
        const relPath = path.relative(
            path.resolve(__dirname, "../../../.."),
            TWIN_SERVICE
        );

        const hasDuplicateChain = content.includes("callAiGeneration");

        if (hasDuplicateChain) {
            throw new Error(
                `  [callAiGeneration]  ->  ${relPath}\n\n` +
                "The inline AI provider fallback chain must be removed from twin.service.ts " +
                "and delegated to ImageProviderService (backend shared module)."
            );
        }
    });
});
