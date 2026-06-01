// ─────────────────────────────────────────────────────────────────────────────
// DEPLOY-TARGET SEAM (M4 — cloud/VPC-neutral, PRD §3.5).
//
// The same agent must run against TWO deploy targets with CONFIG CHANGES ONLY —
// no code change. This module is that seam: a named deploy target resolves to a
// set of endpoints (ingress/admin) and a launch RECIPE for the substrate
// (Restate). The active target is chosen by DURABL_DEPLOY_TARGET; nothing in the
// agent or workflow names a target, so switching targets is config-only.
//
// Two genuinely-distinct targets ship here:
//
//   local   local restate-server binary (devDependency), localhost ports, a
//           local data dir. The M1/M2/M3 target. No Docker, no cloud.
//   docker  a CONTAINERIZED restate (official restatedev/restate image) reached
//           on a DIFFERENT host:port, started/stopped via `docker run`. A truly
//           distinct deploy target: different process model (container), distinct
//           ingress/admin endpoints — yet the SAME agent source runs on it by
//           configuration alone.
//
// Honesty note (carried into docs): "local" is fully exercised by the gate.
// "docker" is exercised iff a Docker daemon is reachable; otherwise the gate
// records it as CONFIG-READY-NOT-RUN and says so explicitly — never faking a run.
//
// A managed/cloud target (e.g. Restate Cloud) is the SAME mechanism: set
// DURABL_RESTATE_INGRESS/_ADMIN to the managed endpoints. We do not have managed
// credentials in this environment, so cloud is documented as config-ready, not
// run. No secrets are read or logged here — endpoints and ports only.
// ─────────────────────────────────────────────────────────────────────────────

import { tmpdir } from "node:os";
import { join } from "node:path";

/** How the substrate process is launched for a target. */
export type LaunchKind = "local-binary" | "docker" | "external";

/** A fully-resolved, code-free description of WHERE the agent is deployed. */
export interface DeployTarget {
  /** Stable target id, e.g. "local", "docker". */
  readonly id: string;
  /** How the substrate is launched (the harness uses this; the agent does not). */
  readonly launch: LaunchKind;
  /** Restate ingress base URL (where invocations are POSTed). */
  readonly ingress: string;
  /** Restate admin base URL (health + deployment registration). */
  readonly admin: string;
  /** Host:port the SDK service binds and that Restate dials back to. */
  readonly servicePort: number;
  /** Local data dir for the substrate (local-binary) — unused for docker/external. */
  readonly dataDir: string;
  /** For docker: the image to run. */
  readonly dockerImage?: string;
  /** For docker: a stable container name so the harness can stop/rm it. */
  readonly dockerContainer?: string;
  /** Human note for evidence. */
  readonly note: string;
}

const DATA_ROOT = process.env.DURABL_DATA_DIR ?? join(tmpdir(), "durabl-m1");

/**
 * Resolve a deploy target by id. Endpoints/ports are overridable by env so the
 * SAME target id can point at a managed/cloud endpoint without code change
 * (e.g. DURABL_RESTATE_INGRESS=https://<managed>). That overridability IS the
 * cloud-neutrality mechanism.
 */
function buildTarget(id: string): DeployTarget {
  switch (id) {
    case "local": {
      const servicePort = Number(process.env.DURABL_SERVICE_PORT ?? 9080);
      return {
        id,
        launch: "external" /* harness starts the local binary itself */,
        ingress: process.env.DURABL_RESTATE_INGRESS ?? "http://localhost:8080",
        admin: process.env.DURABL_RESTATE_ADMIN ?? "http://localhost:9070",
        servicePort,
        dataDir:
          process.env.DURABL_RESTATE_DATA_DIR ?? join(DATA_ROOT, "restate-data"),
        note: "local restate-server binary (devDependency); localhost; no Docker/cloud",
      };
    }
    case "docker": {
      // Distinct ports so docker can run side-by-side with a stray local binary.
      const ingressPort = Number(process.env.DURABL_DOCKER_INGRESS_PORT ?? 8081);
      const adminPort = Number(process.env.DURABL_DOCKER_ADMIN_PORT ?? 9071);
      // The SDK service runs on the host; the container reaches it via the
      // docker host gateway. The host port differs from local to avoid clashes.
      const servicePort = Number(process.env.DURABL_DOCKER_SERVICE_PORT ?? 9081);
      return {
        id,
        launch: "docker",
        ingress:
          process.env.DURABL_DOCKER_RESTATE_INGRESS ??
          `http://localhost:${ingressPort}`,
        admin:
          process.env.DURABL_DOCKER_RESTATE_ADMIN ??
          `http://localhost:${adminPort}`,
        servicePort,
        dataDir: join(DATA_ROOT, "restate-docker-data"),
        dockerImage: process.env.DURABL_DOCKER_IMAGE ?? "restatedev/restate:1.6",
        dockerContainer:
          process.env.DURABL_DOCKER_CONTAINER ?? "durabl-m4-restate",
        note: "containerized restate (docker run); distinct ingress/admin ports; same agent, config-only",
      };
    }
    case "external": {
      // Fully config-driven managed/cloud target: point at any endpoints.
      const servicePort = Number(process.env.DURABL_SERVICE_PORT ?? 9080);
      return {
        id,
        launch: "external",
        ingress: process.env.DURABL_RESTATE_INGRESS ?? "http://localhost:8080",
        admin: process.env.DURABL_RESTATE_ADMIN ?? "http://localhost:9070",
        servicePort,
        dataDir: join(DATA_ROOT, "restate-data"),
        note: "external/managed restate reached purely via DURABL_RESTATE_INGRESS/_ADMIN (cloud-neutral)",
      };
    }
    default:
      throw new Error(
        `unknown DURABL_DEPLOY_TARGET=${JSON.stringify(id)}; known: local, docker, external`,
      );
  }
}

export const DEFAULT_DEPLOY_TARGET = "local";

export function configuredDeployTargetId(): string {
  return process.env.DURABL_DEPLOY_TARGET ?? DEFAULT_DEPLOY_TARGET;
}

/** Resolve the active deploy target from configuration (env only). */
export function getDeployTarget(id = configuredDeployTargetId()): DeployTarget {
  return buildTarget(id);
}
