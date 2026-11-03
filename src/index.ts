#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadDotEnv } from "./config.js";
import { createContextFactory } from "./context.js";
import { createServer, SERVER_NAME, SERVER_VERSION } from "./server.js";

loadDotEnv();
const server = createServer(createContextFactory());
await server.connect(new StdioServerTransport());
// stdout carries the MCP protocol, so log to stderr only.
console.error(`${SERVER_NAME} ${SERVER_VERSION} running on stdio`);
