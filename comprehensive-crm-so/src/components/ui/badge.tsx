import { ComponentProps } from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center justify-center rounded-lg border px-3 py-1.5 text-xs font-semibold w-fit whitespace-nowrap shrink-0 [&>svg]:size-3 gap-1.5 [&>svg]:pointer-events-none transition-all duration-300 overflow-hidden backdrop-blur-sm shadow-sm",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-brand-500 text-white [a&]:hover:bg-brand-600 [a&]:hover:shadow-md",
        secondary:
          "border-transparent bg-corporate-200 dark:bg-corporate-700 text-corporate-800 dark:text-corporate-200 [a&]:hover:bg-corporate-300 dark:[a&]:hover:bg-corporate-600",
        destructive:
          "border-transparent bg-red-500 text-white [a&]:hover:bg-red-600 [a&]:hover:shadow-md",
        outline:
          "glass-morphism border-white/20 text-corporate-700 dark:text-corporate-200 [a&]:hover:bg-white/[0.12] dark:[a&]:hover:bg-black/[0.12]",
        success:
          "border-transparent bg-green-500 text-white [a&]:hover:bg-green-600 [a&]:hover:shadow-md",
        warning:
          "border-transparent bg-amber-500 text-white [a&]:hover:bg-amber-600 [a&]:hover:shadow-md",
        premium:
          "border-transparent bg-gradient-premium text-white [a&]:hover:shadow-md [a&]:hover:scale-105",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant,
  asChild = false,
  ...props
}: ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "span"

  return (
    <Comp
      data-slot="badge"
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
