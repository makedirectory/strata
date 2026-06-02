/**
 * Entrypoint for the Strata MCP server (stdio transport).
 *
 * Run via `npm run mcp` (which uses `npx tsx` so no build step or committed
 * runtime dependency is needed), then point an MCP client at that command. See
 * the "MCP server" section in README.md for client configuration.
 */
import { runStdio } from "./server";

runStdio();
