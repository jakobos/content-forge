import type { Plugin } from "@opencode-ai/plugin"

export const ESLintHook: Plugin = async ({ $, directory }) => {
  return {
    "tool.execute.after": async (input) => {
      if (input.tool !== "edit" && input.tool !== "write") return

      const filePath: string | undefined = (input.args as Record<string, unknown>)?.filePath as string | undefined
      if (!filePath) return

      // Only lint files ESLint understands
      if (!/\.(ts|tsx|js|jsx|astro|mjs|cjs)$/.test(filePath)) return

      try {
        await $`npx eslint --max-warnings=0 ${filePath}`.cwd(directory)
      } catch (err) {
        // ESLint exits non-zero on lint errors; surface them as a warning comment
        const msg = err instanceof Error ? err.message : String(err)
        console.warn(`[eslint-hook] ${filePath}\n${msg}`)
      }
    },
  }
}
