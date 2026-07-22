import {
  cloneElement,
  ComponentProps,
  createContext,
  isValidElement,
  ReactElement,
  ReactNode,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { createPortal } from "react-dom"
import { X } from "lucide-react"

import { cn } from "@/utils"

const TOOLTIP_CURSOR_GAP = 14
const TOOLTIP_COLLISION_PADDING = 12

const TOOLTIP_CONTENT_CLASS = "z-[1200] w-fit max-w-72 rounded-xl border border-white/12 bg-slate-950/96 px-3 py-2 text-[11px] text-slate-50 shadow-[0_16px_36px_rgba(15,23,42,0.34)] backdrop-blur-xl"

type TooltipPoint = { x: number; y: number }
type TooltipSize = { width: number; height: number }

function calculateFollowCursorPosition(
  cursor: TooltipPoint,
  content: TooltipSize,
  viewport: TooltipSize,
  gap = TOOLTIP_CURSOR_GAP,
  padding = TOOLTIP_COLLISION_PADDING,
) {
  const preferredLeft = cursor.x + gap
  const preferredTop = cursor.y + gap
  const left = preferredLeft + content.width <= viewport.width - padding
    ? preferredLeft
    : cursor.x - gap - content.width
  const top = preferredTop + content.height <= viewport.height - padding
    ? preferredTop
    : cursor.y - gap - content.height

  return {
    left: Math.max(padding, Math.min(left, viewport.width - padding - content.width)),
    top: Math.max(padding, Math.min(top, viewport.height - padding - content.height)),
  }
}

type TooltipContextValue = {
  id: string
  open: boolean
  pinned: boolean
  cursor: TooltipPoint | null
  pinOnClick: boolean
  openAt: (cursor: TooltipPoint) => void
  close: () => void
  togglePinned: (cursor: TooltipPoint) => void
}

const TooltipContext = createContext<TooltipContextValue | null>(null)

function TooltipProvider({ children }: { children: ReactNode; delayDuration?: number; skipDelayDuration?: number }) {
  return <>{children}</>
}

function Tooltip({
  children,
  open: controlledOpen,
  defaultOpen = false,
  onOpenChange,
  pinOnClick = false,
}: {
  children: ReactNode
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  pinOnClick?: boolean
}) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen)
  const [pinned, setPinned] = useState(false)
  const [cursor, setCursor] = useState<TooltipPoint | null>(null)
  const id = useId()
  const open = controlledOpen ?? uncontrolledOpen

  const setOpen = (next: boolean) => {
    if (controlledOpen === undefined) setUncontrolledOpen(next)
    onOpenChange?.(next)
  }
  const close = () => {
    setPinned(false)
    setCursor(null)
    setOpen(false)
  }
  const openAt = (nextCursor: TooltipPoint) => {
    setCursor(nextCursor)
    setOpen(true)
  }
  const togglePinned = (nextCursor: TooltipPoint) => {
    if (pinned) {
      close()
      return
    }
    setCursor(nextCursor)
    setPinned(true)
    setOpen(true)
  }

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open])

  const value = useMemo(() => ({ id, open, pinned, cursor, pinOnClick, openAt, close, togglePinned }), [id, open, pinned, cursor, pinOnClick])
  return <TooltipContext.Provider value={value}>{children}</TooltipContext.Provider>
}

function composeHandler<E>(original?: (event: E) => void, next?: (event: E) => void) {
  return (event: E) => {
    original?.(event)
    next?.(event)
  }
}

function cursorFromEvent(event: { clientX?: number; clientY?: number; currentTarget?: EventTarget | null }) {
  const x = Number(event.clientX)
  const y = Number(event.clientY)
  if (Number.isFinite(x) && Number.isFinite(y) && (x !== 0 || y !== 0)) return { x, y }
  const element = event.currentTarget as HTMLElement | null
  const bounds = element?.getBoundingClientRect?.()
  return bounds ? { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 } : { x: 0, y: 0 }
}

function shouldPinEvent(event: any, pinOnClick: boolean) {
  if (!pinOnClick) return false
  const target = event.target as Element | null
  return Boolean(target?.closest?.('[data-tooltip-pin]')) || event.currentTarget?.dataset?.tooltipPin === 'true' || event.currentTarget?.getAttribute?.('role') !== 'button'
}

function TooltipTrigger({
  asChild = false,
  children,
  ...props
}: ComponentProps<'button'> & { asChild?: boolean }) {
  const context = useContext(TooltipContext)
  const child = asChild && isValidElement(children)
    ? children as ReactElement<any>
    : <button type="button" {...props}>{children}</button>
  if (!context || !isValidElement(child)) return child

  // React's isValidElement guard intentionally narrows props to unknown. The
  // trigger is cloned below, so retain its element props after the guard.
  const trigger = child as ReactElement<Record<string, any>>

  const nativeTag = typeof trigger.type === 'string' ? trigger.type : ''
  const nativeInteractive = ['a', 'button', 'input', 'select', 'textarea'].includes(nativeTag)
  const pinTarget = trigger.props['data-tooltip-pin'] === true || trigger.props['data-tooltip-pin'] === 'true'
  const withProps = {
    ...props,
    tabIndex: !nativeInteractive && trigger.props.tabIndex === undefined ? 0 : trigger.props.tabIndex,
    'aria-describedby': context.open ? [trigger.props['aria-describedby'], context.id].filter(Boolean).join(' ') : trigger.props['aria-describedby'],
    onPointerEnter: composeHandler(trigger.props.onPointerEnter, (event: any) => {
      if (!event.pointerType || event.pointerType === 'mouse') context.openAt(cursorFromEvent(event))
    }),
    onPointerMove: composeHandler(trigger.props.onPointerMove, (event: any) => {
      if ((!event.pointerType || event.pointerType === 'mouse') && !context.pinned) context.openAt(cursorFromEvent(event))
    }),
    onPointerLeave: composeHandler(trigger.props.onPointerLeave, (event: any) => {
      if ((!event.pointerType || event.pointerType === 'mouse') && !context.pinned) context.close()
    }),
    onFocus: composeHandler(trigger.props.onFocus, (event: any) => context.openAt(cursorFromEvent(event))),
    onBlur: composeHandler(trigger.props.onBlur, () => { if (!context.pinned) context.close() }),
    onClick: composeHandler(trigger.props.onClick, (event: any) => {
      if (shouldPinEvent(event, context.pinOnClick || pinTarget)) context.togglePinned(cursorFromEvent(event))
    }),
  }
  return cloneElement(trigger, withProps)
}

function FollowCursorTooltipContent({
  id,
  cursor,
  className,
  children,
  pinned,
  onClose,
}: {
  id: string
  cursor: TooltipPoint
  className?: string
  children: ReactNode
  pinned: boolean
  onClose: () => void
}) {
  const contentRef = useRef<HTMLDivElement>(null)
  const [contentSize, setContentSize] = useState<TooltipSize | null>(null)

  useLayoutEffect(() => {
    const element = contentRef.current
    if (!element) return
    const updateSize = () => {
      const bounds = element.getBoundingClientRect()
      setContentSize((current) => current?.width === bounds.width && current?.height === bounds.height
        ? current
        : { width: bounds.width, height: bounds.height })
    }
    updateSize()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateSize)
    observer?.observe(element)
    return () => observer?.disconnect()
  }, [children, className, pinned])

  const viewport = { width: typeof window === 'undefined' ? 0 : window.innerWidth, height: typeof window === 'undefined' ? 0 : window.innerHeight }
  const position = contentSize
    ? calculateFollowCursorPosition(cursor, contentSize, viewport)
    : { left: cursor.x + TOOLTIP_CURSOR_GAP, top: cursor.y + TOOLTIP_CURSOR_GAP }

  return createPortal(
    <div
      ref={contentRef}
      id={id}
      role="tooltip"
      data-slot="tooltip-content"
      data-state={pinned ? 'pinned' : 'open'}
      className={cn(
        "fixed animate-in fade-in-0 zoom-in-95 duration-100",
        pinned ? "pointer-events-auto" : "pointer-events-none",
        TOOLTIP_CONTENT_CLASS,
        className,
      )}
      style={{ left: `${position.left}px`, top: `${position.top}px`, visibility: contentSize ? 'visible' : 'hidden' }}
    >
      {pinned ? (
        <button
          type="button"
          onClick={onClose}
          className="absolute right-1.5 top-1.5 inline-flex h-5 w-5 items-center justify-center rounded-md text-slate-400 transition hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/60"
          aria-label="Fechar tooltip"
        >
          <X className="h-3 w-3" aria-hidden="true" />
        </button>
      ) : null}
      <div className={pinned ? 'pr-5' : undefined}>{children}</div>
    </div>,
    document.body,
  )
}

function TooltipContent({
  className,
  children,
  hidden,
  ..._props
}: ComponentProps<'div'> & { side?: string; align?: string; sideOffset?: number; collisionPadding?: number }) {
  const context = useContext(TooltipContext)
  if (!context || hidden || !context.open || !context.cursor) return null
  return <FollowCursorTooltipContent id={context.id} cursor={context.cursor} className={className} pinned={context.pinned} onClose={context.close}>{children}</FollowCursorTooltipContent>
}

function TooltipCopy({ label, description }: { label: ReactNode; description?: ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="text-[11px] font-medium leading-tight text-white">{label}</div>
      {description ? <div className="text-[10px] leading-snug text-slate-300/92">{description}</div> : null}
    </div>
  )
}

type TooltipOverlayProps = {
  label: ReactNode
  description?: ReactNode
  children: ReactNode
  contentClassName?: string
  followCursor?: boolean
  pinOnClick?: boolean
} & Omit<ComponentProps<typeof TooltipContent>, 'children' | 'className'>

function isNativeInteractiveChild(child: ReactNode) {
  return isValidElement(child) && typeof child.type === 'string' && ['a', 'button', 'input', 'select', 'textarea'].includes(child.type)
}

function TooltipLabel({
  label,
  description,
  children,
  contentClassName,
  followCursor: _followCursor = true,
  pinOnClick,
  ...props
}: TooltipOverlayProps) {
  const canPinOnClick = pinOnClick ?? !isNativeInteractiveChild(children)
  return (
    <Tooltip pinOnClick={canPinOnClick}>
      <TooltipTrigger asChild data-tooltip-pin={canPinOnClick || undefined}>{children}</TooltipTrigger>
      <TooltipContent className={contentClassName} {...props}>
        <TooltipCopy label={label} description={description} />
      </TooltipContent>
    </Tooltip>
  )
}

function TooltipButton({ label, description, children, ...props }: TooltipOverlayProps) {
  return <TooltipLabel label={label} description={description} {...props}>{children}</TooltipLabel>
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
} & Omit<TooltipOverlayProps, 'children' | 'label' | 'description'>) {
  return (
    <TooltipLabel label={label} description={description} {...props}>
      <button
        type="button"
        aria-label={typeof label === 'string' ? label : undefined}
        className={cn(
          "inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/12 bg-white/[0.04] text-slate-100 transition hover:border-white/20 hover:bg-white/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/60",
          className,
        )}
      >
        <span className={cn("inline-flex h-4 w-4 items-center justify-center", iconClassName)}>{icon}</span>
      </button>
    </TooltipLabel>
  )
}

function TooltipTruncate({
  text,
  description,
  className,
  contentClassName,
  ...props
}: {
  text: string
  description?: ReactNode
  className?: string
  contentClassName?: string
} & Omit<ComponentProps<'span'>, 'children'> & Omit<ComponentProps<typeof TooltipContent>, 'children' | 'className'>) {
  return (
    <TooltipLabel label={text} description={description} contentClassName={contentClassName} {...props}>
      <span tabIndex={0} className={cn("inline-block max-w-full truncate focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/60", className)}>{text}</span>
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
  calculateFollowCursorPosition,
}
