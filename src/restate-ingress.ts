// Shared Restate ingress client(s) for out-of-process callers (CLI, replay UI).
// Lazily connects once; dropped on graceful shutdown (SDK has no explicit close).

import { connect, type Ingress } from "@restatedev/restate-sdk-clients";
import { config } from "./config.js";
import { registerGracefulShutdown, shutdownAbort } from "./lifecycle.js";

let ingress: Ingress | undefined;

/** Typed Restate ingress client bound to {@link config.restateIngress}. */
export function restateIngressClient(): Ingress {
  if (!ingress) {
    ingress = connect({ url: config.restateIngress });
    registerGracefulShutdown(() => {
      ingress = undefined;
    });
  }
  return ingress;
}

/** Fetch to Restate ingress that respects process shutdown. */
export function ingressFetch(
  input: string | URL,
  init: RequestInit = {},
): Promise<Response> {
  const signal = init.signal ?? shutdownAbort.signal;
  return fetch(input, { ...init, signal });
}
