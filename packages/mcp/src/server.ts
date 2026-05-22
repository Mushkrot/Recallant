import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { recallantTools } from "./tools.js";

export function createRecallantMcpServer() {
  const server = new McpServer({
    name: "recallant",
    version: "0.0.0"
  });

  for (const tool of recallantTools) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema
      },
      async (args) => ({
        content: [
          {
            type: "text",
            text: JSON.stringify(tool.handler(args as Record<string, unknown>), null, 2)
          }
        ]
      })
    );
  }

  return server;
}

export async function runRecallantStdioServer() {
  const server = createRecallantMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
