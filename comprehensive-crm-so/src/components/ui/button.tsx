import { ComponentProps } from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-semibold transition-all duration-300 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 focus-visible:ring-offset-2 active:scale-[0.98] hover:shadow-premium",
  {
    variants: {
      variant: {
        default:
          "bg-gradient-blue text-white shadow-premium hover:shadow-premium-lg hover:-translate-y-0.5 border-0",
        destructive:
          "bg-gradient-to-r from-red-500 to-red-600 text-white shadow-premium hover:shadow-premium-lg hover:-translate-y-0.5 border-0",
        outline:
          "glass-morphism border border-white/20 text-corporate-700 dark:text-white hover:bg-white/[0.12] dark:hover:bg-black/[0.12] backdrop-blur-xl",
        secondary:
          "bg-corporate-100 dark:bg-corporate-800 text-corporate-700 dark:text-corporate-200 hover:bg-corporate-200 dark:hover:bg-corporate-700 border-0",
        ghost:
          "text-corporate-700 dark:text-corporate-200 hover:bg-white/[0.08] dark:hover:bg-black/[0.08] backdrop-blur-sm",
        link: "text-brand-600 dark:text-brand-400 underline-offset-4 hover:underline hover:text-brand-700 dark:hover:text-brand-300",
        premium:
          "bg-gradient-premium text-white shadow-premium hover:shadow-premium-lg hover:-translate-y-0.5 border-0",
      },
      size: {
        default: "h-9 px-4 py-2 has-[>svg]:px-3",
        sm: "h-8 rounded-md gap-1.5 px-3 has-[>svg]:px-2.5",
        lg: "h-10 rounded-md px-6 has-[>svg]:px-4",
        icon: "size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot : "button"

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
