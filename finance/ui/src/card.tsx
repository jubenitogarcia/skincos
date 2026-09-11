import { ComponentProps, ElementRef, forwardRef } from "react"

import { cn } from "@/utils"

const Card = forwardRef<ElementRef<"div">, ComponentProps<"div">>(function Card(
  { className, ...props },
  ref
) {
  return (
    <div
      ref={ref}
      data-slot="card"
      className={cn(
        "glass-morphism flex flex-col gap-6 rounded-2xl border border-white/20 py-6 shadow-premium backdrop-blur-xl bg-white/[0.08] hover:bg-white/[0.12] transition-all duration-300 hover:shadow-premium-lg hover:-translate-y-1",
        "dark:glass-morphism-dark dark:border-white/10 dark:bg-black/[0.08] dark:hover:bg-black/[0.12]",
        "text-corporate-900 dark:text-white",
        className
      )}
      {...props}
    />
  )
})

const CardHeader = forwardRef<ElementRef<"div">, ComponentProps<"div">>(function CardHeader(
  { className, ...props },
  ref
) {
  return (
    <div
      ref={ref}
      data-slot="card-header"
      className={cn(
        "@container/card-header grid auto-rows-min grid-rows-[auto_auto] items-start gap-2 px-6 has-data-[slot=card-action]:grid-cols-[1fr_auto] [.border-b]:pb-6 [.border-b]:border-white/10",
        className
      )}
      {...props}
    />
  )
})

const CardTitle = forwardRef<ElementRef<"div">, ComponentProps<"div">>(function CardTitle(
  { className, ...props },
  ref
) {
  return (
    <div
      ref={ref}
      data-slot="card-title"
      className={cn("leading-tight font-semibold text-lg text-corporate-900 dark:text-white", className)}
      {...props}
    />
  )
})

const CardDescription = forwardRef<ElementRef<"div">, ComponentProps<"div">>(function CardDescription(
  { className, ...props },
  ref
) {
  return (
    <div
      ref={ref}
      data-slot="card-description"
      className={cn("text-corporate-600 dark:text-corporate-300 text-sm leading-relaxed", className)}
      {...props}
    />
  )
})

const CardAction = forwardRef<ElementRef<"div">, ComponentProps<"div">>(function CardAction(
  { className, ...props },
  ref
) {
  return (
    <div
      ref={ref}
      data-slot="card-action"
      className={cn(
        "col-start-2 row-span-2 row-start-1 self-start justify-self-end",
        className
      )}
      {...props}
    />
  )
})

const CardContent = forwardRef<ElementRef<"div">, ComponentProps<"div">>(function CardContent(
  { className, ...props },
  ref
) {
  return (
    <div
      ref={ref}
      data-slot="card-content"
      className={cn("px-6", className)}
      {...props}
    />
  )
})

const CardFooter = forwardRef<ElementRef<"div">, ComponentProps<"div">>(function CardFooter(
  { className, ...props },
  ref
) {
  return (
    <div
      ref={ref}
      data-slot="card-footer"
      className={cn("flex items-center px-6 [.border-t]:pt-6", className)}
      {...props}
    />
  )
})

Card.displayName = "Card"
CardHeader.displayName = "CardHeader"
CardTitle.displayName = "CardTitle"
CardDescription.displayName = "CardDescription"
CardAction.displayName = "CardAction"
CardContent.displayName = "CardContent"
CardFooter.displayName = "CardFooter"

export {
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardAction,
  CardDescription,
  CardContent,
}
