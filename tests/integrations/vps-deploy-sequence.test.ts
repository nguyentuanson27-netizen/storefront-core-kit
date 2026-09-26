import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

/**
 * Runs the real `deploy/vps/deploy.sh` against a stand-in `docker` that records every call, so these
 * tests pin the order commands actually execute in, not how the script happens to be spelled.
 */

const REPO_ROOT = resolve(import.meta.dirname, "../..");

const FAKE_DOCKER = `#!/usr/bin/env bash
set -euo pipefail
echo "$*" >> "$CALL_LOG"
if [[ "\${1:-}" == "inspect" ]]; then
  echo healthy
  exit 0
fi
args=" $* "
case "$args" in
  *" ps -q postgres "*) echo postgres-container ;;
  *" ps -q app "*) if [[ -f "$FAKE_STATE/app-running" ]]; then echo app-container; fi ;;
  *" stop app "*) rm -f "$FAKE_STATE/app-running" ;;
  *" start app "*) touch "$FAKE_STATE/app-running" ;;
  *" up -d --no-build app caddy "*) touch "$FAKE_STATE/app-running" ;;
  *" pnpm prisma:migrate:deploy "*) exit "\${FAKE_MIGRATE_EXIT:-0}" ;;
  *" exec -T postgres "*) echo fake-dump ;;
esac
`;

type Run = { status: number | null; calls: string[]; stderr: string };

function runDeploy({ appRunning, migrateExit }: { appRunning: boolean; migrateExit: number }): Run {
  const root = mkdtempSync(join(tmpdir(), "deploy-sequence-"));
  try {
    const repo = join(root, "repo");
    const bin = join(root, "bin");
    const state = join(root, "state");
    mkdirSync(join(repo, "deploy/vps"), { recursive: true });
    mkdirSync(bin);
    mkdirSync(state);
    for (const file of ["deploy/vps/deploy.sh", "deploy/vps/project-identity.sh", "project.config.json"]) {
      copyFileSync(join(REPO_ROOT, file), join(repo, file));
    }
    writeFileSync(join(repo, ".gitignore"), "deploy/vps/.env.production\n");
    const git = (...args: string[]) =>
      execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.test", ...args], { cwd: repo })
        .toString()
        .trim();
    git("init", "-q");
    git("add", "-A");
    git("commit", "-q", "-m", "release");
    writeFileSync(join(repo, "deploy/vps/.env.production"), `RELEASE_SHA=${git("rev-parse", "HEAD")}\n`);

    writeFileSync(join(bin, "docker"), FAKE_DOCKER);
    chmodSync(join(bin, "docker"), 0o755);
    if (appRunning) writeFileSync(join(state, "app-running"), "");
    const callLog = join(root, "calls.log");
    writeFileSync(callLog, "");

    const result = spawnSync("bash", ["deploy/vps/deploy.sh"], {
      cwd: repo,
      env: {
        PATH: `${bin}:${process.env.PATH}`,
        HOME: root,
        CALL_LOG: callLog,
        FAKE_STATE: state,
        FAKE_MIGRATE_EXIT: String(migrateExit),
        BACKUP_DIR: join(root, "backups"),
      },
      encoding: "utf8",
    });
    const calls = readFileSync(callLog, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => line.replace(/^compose --env-file \S+ -f \S+ /, ""));
    return { status: result.status, calls, stderr: result.stderr };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function position(calls: string[], command: string): number {
  return calls.findIndex((call) => call === command);
}

const STOP = "stop app";
const MIGRATE = "run --rm ops pnpm prisma:migrate:deploy";
const START_NEW = "up -d --no-build app caddy";
const RESTART_OLD = "start app";
const RELEASE_CHECK = "run --rm ops pnpm release:check";
const BACKUP = "exec -T postgres sh -ec pg_dump -U \"$POSTGRES_USER\" -d \"$POSTGRES_DB\" --format=custom";

test("a release quiesces the serving app, migrates, then starts the new app", () => {
  const run = runDeploy({ appRunning: true, migrateExit: 0 });
  assert.equal(run.status, 0, run.stderr);
  const [check, backup, stop, migrate, start] = [RELEASE_CHECK, BACKUP, STOP, MIGRATE, START_NEW].map((command) =>
    position(run.calls, command),
  );
  assert.ok(check >= 0 && backup > check, "release preflight and backup still precede everything that changes data");
  assert.ok(stop > backup, "the old app stops after the backup");
  assert.ok(migrate > stop, "the migration runs only once the old writer is stopped");
  assert.ok(start > migrate, "the new app starts only after the migration succeeded");
  assert.equal(position(run.calls, RESTART_OLD), -1);
});

test("a failed migration restarts the exact stopped pre-release app and never starts the new one", () => {
  const run = runDeploy({ appRunning: true, migrateExit: 3 });
  assert.notEqual(run.status, 0);
  const stop = position(run.calls, STOP);
  const migrate = position(run.calls, MIGRATE);
  const restart = position(run.calls, RESTART_OLD);
  assert.ok(stop >= 0 && migrate > stop && restart > migrate);
  // `start` resumes the stopped container; `up` would recreate it from the new image.
  assert.equal(position(run.calls, START_NEW), -1);
  assert.equal(run.calls.filter((call) => call.startsWith("up -d") && call.includes(" app")).length, 0);
});

test("with no app running before the release, a failed migration invents no restart target", () => {
  const run = runDeploy({ appRunning: false, migrateExit: 1 });
  assert.notEqual(run.status, 0);
  assert.equal(position(run.calls, STOP), -1);
  assert.equal(position(run.calls, RESTART_OLD), -1);
  assert.equal(position(run.calls, START_NEW), -1);
  assert.ok(position(run.calls, MIGRATE) >= 0);
});

test("a first release with nothing serving migrates and starts the new app", () => {
  const run = runDeploy({ appRunning: false, migrateExit: 0 });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(position(run.calls, STOP), -1);
  assert.ok(position(run.calls, START_NEW) > position(run.calls, MIGRATE));
});
