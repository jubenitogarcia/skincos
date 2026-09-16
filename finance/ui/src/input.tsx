import { ComponentProps } from "react"

import { cn } from "@/utils"

function Input({ className, type, ...props }: ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "glass-morphism flex h-11 w-full min-w-0 rounded-xl border border-white/20 backdrop-blur-xl px-4 py-3 text-sm font-medium transition-all duration-300",
        "bg-white/[0.08] dark:bg-black/[0.08] text-corporate-900 dark:text-white",
        "placeholder:text-corporate-500 dark:placeholder:text-corporate-400",
        "focus:border-brand-500/50 focus:bg-white/[0.12] dark:focus:bg-black/[0.12] focus:shadow-premium focus:outline-none focus:ring-2 focus:ring-brand-500/20",
        "hover:bg-white/[0.10] dark:hover:bg-black/[0.10]",
        "disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
        "file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-corporate-700 dark:file:text-corporate-200",
        "selection:bg-brand-500/20",
        className
      )}
      {...props}
    />
  )
}

export { Input }
