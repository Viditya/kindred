#!/usr/bin/env node
// Local MCP (stdio) entry — for IBM Bob / Claude Desktop / Cursor.
// Identifies the user with KINDRED_EMAIL (account must exist; sign up in the web app first).
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { buildMcpServer } from './mcp.js';
import { userByEmail } from './store.js';

const email = process.env.KINDRED_EMAIL;
const getUser = () => {
  const u = email && userByEmail(email);
  if (!u) throw new Error('Set KINDRED_EMAIL to an existing Kindred account');
  return u;
};
await buildMcpServer(getUser).connect(new StdioServerTransport());
