import type { Plugin } from "@opencode-ai/plugin"

export const TypecheckHook: Plugin = async ({ $, directory }) => {
  return {
    "tool.execute.after": async (input) => {
      if (input.tool !== "edit" && input.tool !== "write") return

      const filePath: string | undefined = (input.args as Record<string, unknown>)?.filePath as string | undefined
      if (!filePath) return

      // Only trigger on TypeScript/Astro source files
      if (!/\.(ts|tsx|astro)$/.test(filePath)) return

      try {
        // astro check covers both .astro and .ts/.tsx files in the project
        await $`npx astro check`.cwd(directory)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.warn(`[typecheck-hook] ${filePath}\n${msg}`)
      }
    },
  }
}
