// Stdout/stderr-only CLI presentation (no extra dependencies).
// Colors and spinners apply only when stderr is a TTY and NO_COLOR is unset.

const useColor =
  Boolean(process.stderr.isTTY) &&
  process.env.NO_COLOR === undefined &&
  process.env.FORCE_COLOR !== "0";

function paint(code: string, text: string): string {
  return useColor ? `\x1b[${code}m${text}\x1b[0m` : text;
}

export const cliStyle = {
  error: (s: string) => paint("31", s),
  warn: (s: string) => paint("33", s),
  info: (s: string) => paint("36", s),
  dim: (s: string) => paint("2", s),
  bold: (s: string) => paint("1", s),
};

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;

/** Run async work with a tty spinner on stderr; no-op when not interactive. */
export async function withSpinner<T>(label: string, work: () => Promise<T>): Promise<T> {
  if (!process.stderr.isTTY) {
    return work();
  }
  let frame = 0;
  const timer = setInterval(() => {
    const ch = SPINNER_FRAMES[frame % SPINNER_FRAMES.length]!;
    frame++;
    process.stderr.write(`\r${cliStyle.info(ch)} ${label}`);
  }, 80);
  try {
    return await work();
  } finally {
    clearInterval(timer);
    process.stderr.write(`\r${" ".repeat(label.length + 4)}\r`);
  }
}

export type CliErrorOptions = {
  code?: number;
  hints?: string[];
};

/** Print a formatted CLI error (never returns). */
export function failCli(message: string, opts: CliErrorOptions = {}): never {
  const { code = 2, hints = [] } = opts;
  console.error(`${cliStyle.error("durabl:")} ${cliStyle.bold("error:")} ${message}`);
  for (const h of hints) {
    console.error(`  ${cliStyle.dim("hint:")} ${h}`);
  }
  process.exit(code);
}

export type CliHintContext = {
  restateIngress?: string;
  harnessLockPath?: string;
};

function errorChain(err: unknown): { message: string; codes: string[] } {
  const codes: string[] = [];
  const parts: string[] = [];
  let cur: unknown = err;
  for (let i = 0; i < 4 && cur != null; i++) {
    if (cur instanceof Error) {
      parts.push(cur.message);
      if ("code" in cur && (cur as NodeJS.ErrnoException).code) {
        codes.push(String((cur as NodeJS.ErrnoException).code));
      }
      cur = cur.cause;
    } else {
      parts.push(String(cur));
      break;
    }
  }
  return { message: parts.join(" — "), codes };
}

/** Map common failure modes to actionable fix hints. */
export function hintsForFailure(err: unknown, ctx: CliHintContext = {}): string[] {
  const hints: string[] = [];
  const { message, codes } = errorChain(err);

  const ingress = ctx.restateIngress ?? "http://localhost:8080";
  const lockPath = ctx.harnessLockPath ?? "/tmp/durabl-harness.lock";

  if (codes.includes("EADDRINUSE") || /EADDRINUSE/i.test(message)) {
    hints.push(
      "Port already in use. Replay UI: `durabl ui --port <p>` or `DURABL_UI_PORT=<p>`.",
    );
    hints.push(
      `Restate ingress (default :8080): free the port or set DURABL_RESTATE_INGRESS (current: ${ingress}).`,
    );
  }

  if (
    codes.includes("ECONNREFUSED") ||
    /fetch failed|ECONNREFUSED|connection refused/i.test(message)
  ) {
    if (message.includes("8080") || ingress.includes("8080")) {
      hints.push(
        "Restate ingress on :8080 is not reachable. Start it: `docker compose --profile docker-demo up -d` or run the local restate-server.",
      );
      hints.push(`Set DURABL_RESTATE_INGRESS if ingress is not at ${ingress}.`);
    } else {
      hints.push(`Check DURABL_RESTATE_INGRESS (${ingress}) and that Restate is running.`);
    }
  }

  if (/harness lock/i.test(message) || message.includes(lockPath)) {
    hints.push(
      `Another gate harness may hold ${lockPath}. Wait for it to finish, or if the PID is dead: rm -f ${lockPath}`,
    );
    hints.push("Run gates one at a time (`npm run gate`, not parallel).");
  }

  if (codes.includes("SQLITE_BUSY") || /database is locked/i.test(message)) {
    hints.push(
      "Journal database is locked by another process. Stop other `durabl` / gate runs using the same DURABL_DATA_DIR.",
    );
    hints.push("Set DURABL_JOURNAL_DB to isolate concurrent experiments.");
  }

  if (/\.git\/index\.lock/i.test(message)) {
    hints.push(
      "Git index lock present. Close other git processes; if none are running, remove .git/index.lock after verifying no git operation is active.",
    );
  }

  return [...new Set(hints)];
}

/** Print a runtime failure (exit 1) with inferred hints. */
export function failRuntime(err: unknown, ctx: CliHintContext = {}): never {
  const message = err instanceof Error ? err.message : String(err);
  const hints = hintsForFailure(err, ctx);
  console.error(`${cliStyle.error("durabl:")} ${cliStyle.bold("error:")} ${message}`);
  for (const h of hints) {
    console.error(`  ${cliStyle.dim("hint:")} ${h}`);
  }
  process.exit(1);
}
