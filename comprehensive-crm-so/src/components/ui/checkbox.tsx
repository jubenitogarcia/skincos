"use client"

import { ComponentProps } from "react"
import * as CheckCircleboxPrimitive from "@radix-ui/react-checkbox"
import CheckCircleIcon from "lucide-react/dist/esm/icons/check"

import { cn } from "@/lib/utils"

function CheckCirclebox({
  className,
  ...props
}: ComponentProps<typeof CheckCircleboxPrimitive.Root>) {
  return (
    <CheckCircleboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "peer border-input dark:bg-input/30 data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground dark:data-[state=checked]:bg-primary data-[state=checked]:border-primary focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive size-4 shrink-0 rounded-[4px] border shadow-xs transition-shadow outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    >
      <CheckCircleboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="flex items-center justify-center text-current transition-none"
      >
        <CheckCircleIcon className="size-3.5" />
      </CheckCircleboxPrimitive.Indicator>
    </CheckCircleboxPrimitive.Root>
  )
}

export { CheckCirclebox }
