import type { Tool, ToolRegistry, ToolResult } from "./types";

export function createToolRegistry(): ToolRegistry {
  const tools = new Map<string, Tool>();

  return {
    register(tool: Tool): void {
      tools.set(tool.definition.name, tool);
    },

    get(name: string): Tool | undefined {
      return tools.get(name);
    },

    list() {
      return Array.from(tools.values()).map((t) => t.definition);
    },

    async execute(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<ToolResult> {
      const tool = tools.get(name);
      if (!tool) {
        return { ok: false, error: `Tool not found: ${name}` };
      }

      if (signal?.aborted) {
        return { ok: false, error: "Operation aborted" };
      }

      try {
        return await tool.handler(args, signal);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Tool execution failed";
        return { ok: false, error: message };
      }
    },
  };
}
