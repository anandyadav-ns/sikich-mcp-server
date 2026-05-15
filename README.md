# Sikich NetSuite MCP Server

A lightweight MCP (Model Context Protocol) server that gives Claude access to
NetSuite File Cabinet tools not available in the standard NetSuite MCP SuiteApp.

## Tools exposed

| Tool | Description |
|------|-------------|
| `ns_readFile` | Read file content from File Cabinet by internal ID |
| `ns_listFolder` | List files in a File Cabinet folder |
| `ns_getInstalledBundles` | List all installed bundles + script IDs they own |
| `ns_getScriptWithFile` | Script record + deployments + full file content |

## Architecture

```
Claude.ai Artifact
    ↓ MCP protocol (SSE)
Sikich MCP Server (Vercel) ← this repo
    ↓ HTTP fetch (server-to-server, no CORS)
Sikich MCP Companion Suitelet (NetSuite)
    ↓ N/file, N/search, N/record
NetSuite File Cabinet + Script Records
```

## Prerequisites

- Node.js 18+
- npm
- A GitHub account
- A Vercel account (free at vercel.com)
- Sikich MCP Companion Suitelet deployed in NetSuite (script 1189)

## Local development

```bash
# 1. Install dependencies
npm install

# 2. Copy env file
cp .env.example .env
# Edit .env with your Companion Suitelet URL

# 3. Start the server
npm run dev

# 4. Test health check
curl http://localhost:3000/

# 5. Test a tool via SSE (use a MCP client or curl)
curl http://localhost:3000/sse
```

## Deploy to Vercel

### Option A — GitHub (recommended)

```bash
# 1. Create a GitHub repo and push this code
git init
git add .
git commit -m "Initial commit — Sikich MCP Server"
git remote add origin https://github.com/YOUR_USERNAME/sikich-mcp-server.git
git push -u origin main

# 2. Go to vercel.com → Import Project → select your repo
# 3. Add environment variable:
#    COMPANION_URL = your full Suitelet URL
# 4. Deploy
```

### Option B — Vercel drag and drop

1. Go to vercel.com/new
2. Drag and drop this entire folder
3. Add environment variable COMPANION_URL
4. Deploy

## Add to Claude.ai

1. Go to Claude.ai → Settings → Integrations → Add custom connector
2. Enter your Vercel deployment URL (e.g. https://sikich-mcp-server.vercel.app/sse)
3. Claude will discover all 4 tools automatically

## Updating the Companion URL

The `ns-at` token in the Companion URL is a NetSuite session token that
may expire. To update it:

1. Log into NetSuite
2. Go to Customization → Scripting → Script Deployments
3. Find Sikich MCP Companion → open the deployment record
4. Copy the new External URL
5. Update COMPANION_URL in Vercel environment variables
6. Vercel redeploys automatically

## Security notes

- The Companion Suitelet is deployed with "Available Without Login = true"
  on a sandbox/demo account — acceptable for Sikich internal tooling
- For production client accounts, add OAuth 1.0 signing to callCompanion()
- Never commit the .env file or the ns-at token to Git
