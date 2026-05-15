/**
 * Sikich NetSuite MCP Server
 * ──────────────────────────────────────────────────────────────────────────
 * A lightweight MCP (Model Context Protocol) server that proxies requests
 * to the Sikich MCP Companion Suitelet deployed in NetSuite.
 *
 * Because this runs on a server (not in a browser), it can call the
 * NetSuite Suitelet freely — no CORS restrictions apply.
 *
 * Tools exposed:
 *   ns_readFile            — Read file content from File Cabinet by ID
 *   ns_listFolder          — List files in a File Cabinet folder
 *   ns_getInstalledBundles — List all installed bundles + their script IDs
 *   ns_getScriptWithFile   — Script record + deployments + file content
 *
 * Hosting: Vercel (free tier) or any Node.js host
 * Protocol: MCP over HTTP (SSE transport)
 */

import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { z } from "zod";

// ── Configuration ──────────────────────────────────────────────────────────
// The Companion Suitelet URL — update this when deploying to a new account.
// Set COMPANION_URL as an environment variable in Vercel for security.
const COMPANION_URL = process.env.COMPANION_URL || 
  "https://tstdrv2690802.extforms.netsuite.com/app/site/hosting/scriptlet.nl?script=1189&deploy=1&compid=TSTDRV2690802&ns-at=AAEJ7tMQ2C6P9rBhvCfzY21lWVO4Vb3n36anzPlgFITMjK05y9s";

const PORT = process.env.PORT || 3000;

// ── Companion caller ───────────────────────────────────────────────────────
/**
 * Calls the Sikich MCP Companion Suitelet.
 * Server-side fetch — no CORS restrictions.
 */
async function callCompanion(tool, params = {}) {
  const qs = new URLSearchParams({ tool });
  for(const [k, v] of Object.entries(params)) {
    if(v !== undefined && v !== null) qs.set(k, String(v));
  }
  const url = `${COMPANION_URL}&${qs.toString()}`;

  const response = await fetch(url, {
    method: "GET",
    headers: { "Accept": "application/json" },
    signal: AbortSignal.timeout(30000), // 30 second timeout
  });

  if(!response.ok) {
    throw new Error(`Companion HTTP ${response.status}: ${response.statusText}`);
  }

  const data = await response.json();

  if(data?.error) {
    throw new Error(`Companion error [${data.error.code}]: ${data.error.message}`);
  }

  return data;
}

// ── MCP Server setup ───────────────────────────────────────────────────────
const server = new McpServer({
  name:    "sikich-netsuite-companion",
  version: "1.0.0",
});

// ── Tool: ns_readFile ──────────────────────────────────────────────────────
server.tool(
  "ns_readFile",
  "Read a file from the NetSuite File Cabinet by its internal ID. Returns the file name, folder, type, size, and full text content including JavaScript source code.",
  {
    fileId: z.number().describe("Internal ID of the file to read (e.g. 2547)"),
  },
  async ({ fileId }) => {
    const result = await callCompanion("ns_readFile", { fileId });
    return {
      content: [{
        type: "text",
        text: JSON.stringify(result, null, 2),
      }],
    };
  }
);

// ── Tool: ns_listFolder ────────────────────────────────────────────────────
server.tool(
  "ns_listFolder",
  "List all files in a NetSuite File Cabinet folder. Accepts either a folder internal ID or a folder path string (e.g. 'SuiteScripts/Sikich').",
  {
    folderId:          z.number().optional().describe("Internal ID of the folder"),
    folderPath:        z.string().optional().describe("Path string to match (e.g. 'SuiteScripts')"),
    includeSubfolders: z.boolean().optional().describe("Include files in subfolders (default: false)"),
  },
  async ({ folderId, folderPath, includeSubfolders }) => {
    const result = await callCompanion("ns_listFolder", { folderId, folderPath, includeSubfolders });
    return {
      content: [{
        type: "text",
        text: JSON.stringify(result, null, 2),
      }],
    };
  }
);

// ── Tool: ns_getInstalledBundles ───────────────────────────────────────────
server.tool(
  "ns_getInstalledBundles",
  "Returns all installed bundles in the NetSuite account with their internal IDs, names, versions, and the complete list of script IDs they own. Use allBundleScriptIds to filter out bundle-owned scripts from a custom script list.",
  {},
  async () => {
    const result = await callCompanion("ns_getInstalledBundles");
    return {
      content: [{
        type: "text",
        text: JSON.stringify(result, null, 2),
      }],
    };
  }
);

// ── Tool: ns_getScriptWithFile ─────────────────────────────────────────────
server.tool(
  "ns_getScriptWithFile",
  "Returns a NetSuite script record's full metadata combined with the actual JavaScript source code of its script file, plus all deployment records — in a single call. This is the primary tool for deep AI-powered script analysis.",
  {
    scriptId: z.number().describe("Internal ID of the NetSuite script record (e.g. 1186)"),
  },
  async ({ scriptId }) => {
    const result = await callCompanion("ns_getScriptWithFile", { scriptId });
    return {
      content: [{
        type: "text",
        text: JSON.stringify(result, null, 2),
      }],
    };
  }
);

// ── Express app + SSE transport ────────────────────────────────────────────
const app = express();
app.use(express.json());

// Store active SSE transports keyed by session ID
const transports = {};

/**
 * SSE endpoint — Claude connects here to establish an MCP session.
 * Claude.ai will call GET /sse to open a persistent connection.
 */
app.get("/sse", async (req, res) => {
  console.log(`[${new Date().toISOString()}] New SSE connection from ${req.ip}`);

  const transport = new SSEServerTransport("/messages", res);
  transports[transport.sessionId] = transport;

  res.on("close", () => {
    console.log(`[${new Date().toISOString()}] SSE connection closed: ${transport.sessionId}`);
    delete transports[transport.sessionId];
  });

  await server.connect(transport);
});

/**
 * Messages endpoint — Claude sends tool calls here.
 */
app.post("/messages", async (req, res) => {
  const sessionId = req.query.sessionId;
  const transport = transports[sessionId];

  if(!transport) {
    console.error(`No transport found for session: ${sessionId}`);
    return res.status(404).json({ error: "Session not found" });
  }

  await transport.handlePostMessage(req, res, req.body);
});

/**
 * Health check endpoint — Vercel and monitoring tools use this.
 */
app.get("/", (req, res) => {
  res.json({
    name:    "Sikich NetSuite MCP Server",
    version: "1.0.0",
    status:  "running",
    tools:   ["ns_readFile", "ns_listFolder", "ns_getInstalledBundles", "ns_getScriptWithFile"],
    companion: COMPANION_URL.split("?")[0], // Log base URL only, not the token
  });
});

/**
 * HEAD / — required by Claude.ai MCP connector discovery.
 */
app.head("/", (req, res) => {
  res.sendStatus(200);
});

// ── Start ──────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`Sikich MCP Server running on port ${PORT}`);
  console.log(`Health: http://localhost:${PORT}/`);
  console.log(`SSE:    http://localhost:${PORT}/sse`);
  console.log(`Companion: ${COMPANION_URL.split("?")[0]}`);
});
