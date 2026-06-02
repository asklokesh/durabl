// Restate SDK HTTP/2 service entry — hosts AgentRun + HitlAgentRun with graceful stop.

import * as http2 from "node:http2";
import * as restate from "@restatedev/restate-sdk";
import { config } from "./config.js";
import { agentRun } from "./workflow.js";
import { hitlAgentRun } from "./hitl-workflow.js";
import {
  closeHttp2Server,
  installSignalHandlers,
  registerGracefulShutdown,
} from "./lifecycle.js";

export async function startRestateService(): Promise<http2.Http2Server> {
  const endpoint = restate.endpoint().bind(agentRun).bind(hitlAgentRun);
  const server = http2.createServer(endpoint.http2Handler());

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.servicePort, () => resolve());
  });

  const bound = server.address();
  const port =
    bound && typeof bound !== "string" ? bound.port : config.servicePort;
  console.log(`durabl Restate service listening on ${port}`);

  registerGracefulShutdown(() => closeHttp2Server(server));
  installSignalHandlers();

  return server;
}
