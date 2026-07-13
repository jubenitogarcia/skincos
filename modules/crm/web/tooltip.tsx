import {
  cloneElement,
  ComponentProps,
  isValidElement,
  ReactElement,
  ReactNode,
  useState,
} from "react"
import * as TooltipPrimitive from "@radix-ui/react-tooltip"

import { cn } from "@/utils"

const TOOLTIP_DELAY = 180
const TOOLTIP_SKIP_DELAY = 80
const TOOLTIP_SIDE_OFFSET = 8
const TOOLTIP_COLLISION_PADDING = 12

function TooltipProvider({
  delayDuration = TOOLTIP_DELAY,
  skipDelayDuration = TOOLTIP_SKIP_DELAY,
  ...props
}: ComponentProps<typeof TooltipPrimitive.Provider>) {
  return (
    <TooltipPrimitive.Provider
      data-slot="tooltip-provider"
      delayDuration={delayDuration}
      skipDelayDuration={skipDelayDuration}
      {...props}
    />
  )
}

function Tooltip({
  ...props
}: ComponentProps<typeof TooltipPrimitive.Root>) {
  return (
    <TooltipProvider>
      <TooltipPrimitive.Root data-slot="tooltip" {...props} />
    </TooltipProvider>
  )
}

function TooltipTrigger({
  ...props
}: ComponentProps<typeof TooltipPrimitive.Trigger>) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />
}

function TooltipContent({
  className,
  sideOffset = TOOLTIP_SIDE_OFFSET,
  children,
  ...props
}: ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        collisionPadding={TOOLTIP_COLLISION_PADDING}
        className={cn(
          "animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-[120] w-fit max-w-72 origin-(--radix-tooltip-content-transform-origin) rounded-xl border border-white/12 bg-slate-950/96 px-3 py-2 text-[11px] text-slate-50 shadow-[0_16px_36px_rgba(15,23,42,0.34)] backdrop-blur-xl",
          className
        )}
        {...props}
      >
        {children}
        <TooltipPrimitive.Arrow className="fill-slate-950/96 z-[119] size-3" />
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  )
}

function TooltipCopy({
  label,
  description,
}: {
  label: ReactNode
  description?: ReactNode
}) {
  return (
    <div className="space-y-1">
      <div className="text-[11px] font-medium leading-tight text-white">{label}</div>
      {description ? (
        <div className="text-[10px] leading-snug text-slate-300/92">{description}</div>
      ) : null}
    </div>
  )
}

type TooltipOverlayProps = {
  label: ReactNode
  description?: ReactNode
  children: ReactNode
  contentClassName?: string
} & Omit<ComponentProps<typeof TooltipContent>, "children" | "className">

function composeHandler<E>(
  original?: (event: E) => void,
  next?: (event: E) => void
) {
  return (event: E) => {
    original?.(event)
    next?.(event)
  }
}

function enhanceTooltipTrigger(
  child: ReactNode,
  setOpen: (open: boolean) => void
) {
  if (!isValidElement(child)) return child
  const element = child as ReactElement<any>
  const nativeTag = typeof element.type === "string" ? element.type : ""
  const nativeInteractive = ["a", "button", "input", "select", "textarea"].includes(nativeTag)
  const shouldAddTabIndex = !nativeInteractive && element.props.tabIndex === undefined
  return cloneElement(element, {
    tabIndex: shouldAddTabIndex ? 0 : element.props.tabIndex,
    onPointerEnter: composeHandler(element.props.onPointerEnter, (event: any) => {
      const pointerType = event?.pointerType
      if (!pointerType || pointerType === "mouse") {
        setOpen(true)
      }
    }),
    onPointerLeave: composeHandler(element.props.onPointerLeave, (event: any) => {
      const pointerType = event?.pointerType
      if (!pointerType || pointerType === "mouse") {
        setOpen(false)
      }
    }),
    onPointerDown: composeHandler(element.props.onPointerDown, (event: PointerEvent) => {
      const pointerType = (event as PointerEvent & { pointerType?: string }).pointerType
      if (pointerType === "touch" || pointerType === "pen") {
        setOpen(true)
      }
    }),
    onFocus: composeHandler(element.props.onFocus, () => setOpen(true)),
    onBlur: composeHandler(element.props.onBlur, () => setOpen(false)),
    onKeyDown: composeHandler(element.props.onKeyDown, (event: KeyboardEvent) => {
      if ((event as KeyboardEvent).key === "Escape") {
        setOpen(false)
      }
    }),
  })
}

function TooltipLabel({
  label,
  description,
  children,
  contentClassName,
  side = "top",
  align = "center",
  ...props
}: TooltipOverlayProps) {
  const [open, setOpen] = useState(false)
  const trigger = enhanceTooltipTrigger(children, setOpen)
  return (
    <Tooltip open={open} onOpenChange={setOpen}>
      <TooltipTrigger asChild>{trigger}</TooltipTrigger>
      <TooltipContent
        side={side}
        align={align}
        className={contentClassName}
        onPointerDownOutside={() => setOpen(false)}
        {...props}
      >
        <TooltipCopy label={label} description={description} />
      </TooltipContent>
    </Tooltip>
  )
}

function TooltipButton({
  label,
  description,
  children,
  ...props
}: TooltipOverlayProps) {
  return (
    <TooltipLabel label={label} description={description} {...props}>
      {children}
    </TooltipLabel>
  )
}

function TooltipIcon({
  label,
  description,
  icon,
  className,
  iconClassName,
  ...props
}: {
  label: ReactNode
  description?: ReactNode
  icon: ReactNode
  className?: string
  iconClassName?: string
} & Omit<TooltipOverlayProps, "children" | "label" | "description">) {
  return (
    <TooltipLabel label={label} description={description} {...props}>
      <button
        type="button"
        aria-label={typeof label === "string" ? label : undefined}
        className={cn(
          "inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/12 bg-white/[0.04] text-slate-100 transition hover:border-white/20 hover:bg-white/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/60",
          className
        )}
      >
        <span className={cn("inline-flex h-4 w-4 items-center justify-center", iconClassName)}>
          {icon}
        </span>
      </button>
    </TooltipLabel>
  )
}

function TooltipTruncate({
  text,
  description,
  className,
  contentClassName,
  side = "top",
  align = "center",
  ...props
}: {
  text: string
  description?: ReactNode
  className?: string
  contentClassName?: string
} & Omit<ComponentProps<"span">, "children"> &
  Omit<ComponentProps<typeof TooltipContent>, "children" | "className">) {
  return (
    <TooltipLabel
      label={text}
      description={description}
      side={side}
      align={align}
      contentClassName={contentClassName}
      {...props}
    >
      <span
        tabIndex={0}
        className={cn(
          "inline-block max-w-full truncate focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/60",
          className
        )}
      >
        {text}
      </span>
    </TooltipLabel>
  )
}

export {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
  TooltipCopy,
  TooltipLabel,
  TooltipButton,
  TooltipIcon,
  TooltipTruncate,
}
