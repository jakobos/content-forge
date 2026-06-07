// Tool execution result — always returns one of these, never throws
export type ToolResult = { ok: true; output: string } | { ok: false; error: string };

// Handler signature for every tool
export type ToolHandler = (args: Record<string, unknown>, signal?: AbortSignal) => Promise<ToolResult>;

// Execution semantic classification
export type ToolType = "sync" | "async" | "agent";

// The definition sent to the LLM (JSON Schema for parameters)
export interface FunctionTool {
  type: "function";
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

// Full tool definition combining schema + handler
export interface Tool {
  type: ToolType;
  definition: FunctionTool;
  handler: ToolHandler;
}

// Runtime registry interface
export interface ToolRegistry {
  register(tool: Tool): void;
  get(name: string): Tool | undefined;
  /** Returns only FunctionTool definitions (what the LLM sees). */
  list(): FunctionTool[];
  execute(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<ToolResult>;
}
