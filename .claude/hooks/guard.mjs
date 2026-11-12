// Project hooks for Claude Code. Deterministic guards for rules CLAUDE.md states in prose.
//
//   node .claude/hooks/guard.mjs pre    PreToolUse  (Edit|Write|NotebookEdit) -> blocks (exit 2)
//   node .claude/hooks/guard.mjs post   PostToolUse (Edit|Write)               -> feedback to the model
//
// Node because it is already required by the pnpm workspace on every machine
// (Windows collector PC, Mac, CI); no jq, no python3 alias. Every check fails OPEN
// on an unexpected error: a broken hook must never wedge the session.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

const mode = process.argv[2];
let event = {};
try {
  event = JSON.parse(await new Promise((res) => {
    let s = "";
    process.stdin.on("data", (d) => (s += d));
    process.stdin.on("end", () => res(s || "{}"));
  }));
} catch {
  process.exit(0);
}

const root = process.env.CLAUDE_PROJECT_DIR || event.cwd || process.cwd();
const input = event.tool_input || {};
const target = input.file_path || input.notebook_path;
if (!target) process.exit(0);

const abs = path.resolve(root, target);
const rel = path.relative(root, abs).split(path.sep).join("/");
if (rel.startsWith("..")) process.exit(0); // outside the repo: not ours to judge
const base = path.posix.basename(rel);

const block = (msg) => {
  process.stderr.write(`${msg}\n`);
  process.exit(2);
};
const tell = (msg) => {
  process.stdout.write(
    JSON.stringify({ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: msg } }),
  );
  process.exit(0);
};

// ---------------------------------------------------------------- PreToolUse
if (mode === "pre") {
  if (rel.startsWith("legacy/")) {
    block(
      "BLOCKED: legacy/ is quarantine (CLAUDE.md). Never edit it. To promote code: read it, rewrite it in the new package, commit a sanitized fixture, add a replay test (docs/legacy-triage.md).",
    );
  }
  if (rel.startsWith("modules/")) {
    block(
      "BLOCKED: modules/ is never created (CLAUDE.md). Each of its names already has a home in services/, supabase/migrations/ or apps/dashboard/src/features/.",
    );
  }
  if (/\.(pcap|pcapng|db|db-wal|db-shm|sqlite3?)$/i.test(base) || (/^\.env(\..+)?$/.test(base) && base !== ".env.example")) {
    block(
      `BLOCKED: ${rel} is a secret/data artifact (raw PCAPs hold the collector UID and session signature; .env holds keys). Data artifacts live in a sibling directory outside the repo (CLAUDE.md "Secrets").`,
    );
  }
  process.exit(0);
}

// --------------------------------------------------------------- PostToolUse
if (mode === "post") {
  const written = String(input.new_string ?? input.content ?? "");
  const notes = [];

  // 1. Migration numbering: take the next number from origin/main, and never reuse one.
  const mig = rel.match(/^supabase\/migrations\/(\d+)_.+\.sql$/);
  if (mig) {
    const version = BigInt(mig[1]);
    try {
      const names = execFileSync("git", ["ls-tree", "--name-only", "origin/main", "supabase/migrations/"], {
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      })
        .split("\n")
        .filter(Boolean)
        .map((f) => path.posix.basename(f));
      const onMain = names.includes(base);
      const highest = names.map((n) => BigInt(n.split("_")[0])).reduce((a, b) => (b > a ? b : a), 0n);
      if (!onMain && version <= highest) {
        block(
          `MIGRATION NUMBER: ${base} is not on origin/main and its version ${version} is at or below main's highest (${highest}). Two branches that each took the next free number pass CI alone and collide on merge (0165, 0258, 0262, 0309). Rename the file (and its pgTAP test and any comment that cites the number) to ${highest + 1n}, then run scripts/check-migration-order.sh.`,
        );
      }
    } catch {
      /* no origin/main fetched: fall through to the local duplicate check */
    }
    try {
      const dup = readdirSync(path.join(root, "supabase/migrations")).filter((f) => f.startsWith(`${mig[1]}_`));
      if (dup.length > 1) block(`MIGRATION NUMBER: version ${mig[1]} is used by ${dup.join(", ")}.`);
    } catch {
      /* ignore */
    }
    if (/\b(create\s+policy|alter\s+policy|enable\s+row\s+level\s+security|grant\s|revoke\s)/i.test(written)) {
      notes.push(
        "RLS/GRANT change: spec §20.2 requires a pgTAP NEGATIVE test proving the unauthorized read fails, in the same PR. Run `pnpm db:test:local` before pushing.",
      );
    }
    if (/scoring_version/i.test(written)) {
      notes.push("Scoring change: write a NEW version; never overwrite historical scores (CLAUDE.md).");
    }
  }

  // 2. pgTAP tests: the three traps that have burned this suite repeatedly.
  if (/^supabase\/tests\/.+\.sql$/.test(rel)) {
    if (/scoring_version\s*=\s*\d/i.test(written)) {
      notes.push(
        "Do not pin scoring_version in a test: read rank_period_latest. Pinning has broken the suite at versions 3, 4 and 6 (CLAUDE.md).",
      );
    }
  }

  // 3. Lint the file just written (check only; never reformat behind the author's back).
  const lint = (cmd, args, cwd) => {
    const r = spawnSync(cmd, args, { cwd, encoding: "utf8", timeout: 45000 });
    if (r.error || r.status === null) return; // tool missing or timed out: skip silently
    const out = `${r.stdout}${r.stderr}`;
    if (/Failed to spawn|command not found|not found/i.test(out)) return; // env not installed here: not a lint failure
    if (r.status !== 0) block(`LINT (${cmd} ${args.join(" ")}):\n${(r.stdout + r.stderr).trim().slice(0, 2500)}`);
  };
  if (/^services\/collector\/.+\.py$/.test(rel) && existsSync(path.join(root, "services/collector/.venv"))) {
    lint("uv", ["run", "--no-sync", "ruff", "check", abs], path.join(root, "services/collector"));
  } else if (/^(apps|packages)\/.+\.(ts|tsx|json)$/.test(rel) && existsSync(path.join(root, "node_modules/.bin/biome"))) {
    lint("pnpm", ["exec", "biome", "check", abs], root);
  }

  if (notes.length) tell(notes.join("\n"));
}
process.exit(0);
