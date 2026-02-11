import { ComponentProps, useEffect, useRef, useState } from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import XIcon from "lucide-react/dist/esm/icons/x"

import { cn } from "@/utils"

type DialogSize = "default" | "wideTable"
type DialogContentProps = ComponentProps<typeof DialogPrimitive.Content> & {
  resizable?: boolean
  size?: DialogSize
}

function Dialog({
  ...props
}: ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger({
  ...props
}: ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({
  ...props
}: ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({
  ...props
}: ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({
  className,
  ...props
}: ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-black/50",
        className
      )}
      {...props}
    />
  )
}

function DialogContent({
  resizable,
  size = "default",
  className,
  children,
  ...props
}: DialogContentProps) {
  const contentRef = useRef<HTMLDivElement | null>(null)
  const [canResize, setCanResize] = useState(false)
  const [resizeSize, setResizeSize] = useState<{ width: number; height: number } | null>(null)
  const sizeClassName =
    size === "wideTable"
      ? "lg:w-[96vw] lg:max-w-[96rem] xl:w-[94vw] xl:max-w-[112rem]"
      : ""
  const allowResize = resizable ?? true

  useEffect(() => {
    if (!allowResize || typeof window === "undefined") {
      setCanResize(false)
      return
    }
    const media = window.matchMedia("(pointer: coarse)")
    const update = () => {
      setCanResize(!media.matches && window.innerWidth >= 768)
    }
    update()
    try {
      media.addEventListener("change", update)
      window.addEventListener("resize", update)
      return () => {
        media.removeEventListener("change", update)
        window.removeEventListener("resize", update)
      }
    } catch {
      media.addListener(update)
      window.addEventListener("resize", update)
      return () => {
        media.removeListener(update)
        window.removeEventListener("resize", update)
      }
    }
  }, [allowResize])

  const handleResizeStart = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!canResize || !contentRef.current) return
    const rect = contentRef.current.getBoundingClientRect()
    const startX = event.clientX
    const startY = event.clientY
    const startWidth = rect.width
    const startHeight = rect.height
    const minWidth = 420
    const minHeight = 260
    const onMove = (moveEvent: PointerEvent) => {
      const dx = moveEvent.clientX - startX
      const dy = moveEvent.clientY - startY
      const maxWidth = window.innerWidth - 16
      const maxHeight = window.innerHeight - 16
      const nextWidth = Math.min(maxWidth, Math.max(minWidth, startWidth + dx))
      const nextHeight = Math.min(maxHeight, Math.max(minHeight, startHeight + dy))
      setResizeSize({ width: nextWidth, height: nextHeight })
    }
    const onUp = () => {
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onUp)
    }
    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", onUp)
    event.preventDefault()
    event.stopPropagation()
  }

  const mergedStyle = resizeSize ? { ...props.style, width: resizeSize.width, height: resizeSize.height } : props.style
  return (
    <DialogPortal data-slot="dialog-portal">
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        className={cn(
          "bg-background data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 fixed top-[50%] left-[50%] z-50 grid w-full max-w-[calc(100%-1rem)] max-h-[calc(100dvh-1rem)] translate-x-[-50%] translate-y-[-50%] gap-3 overflow-y-auto overscroll-contain rounded-lg border p-3 shadow-lg duration-200 sm:max-w-lg sm:max-h-[calc(100dvh-2rem)] sm:gap-4 sm:p-5",
          sizeClassName,
          className
        )}
        ref={contentRef}
        style={mergedStyle}
        {...props}
      >
        {children}
        {canResize ? (
          <div
            className="absolute bottom-2 right-2 h-4 w-4 cursor-se-resize text-blue-200/50 hover:text-blue-100/80"
            onPointerDown={handleResizeStart}
            aria-hidden="true"
          >
            <svg viewBox="0 0 16 16" fill="none" aria-hidden>
              <path d="M4 12h8M7 15h5M10 9h2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </div>
        ) : null}
        <DialogPrimitive.Close className="ring-offset-background focus:ring-ring data-[state=open]:bg-accent data-[state=open]:text-muted-foreground absolute top-3 right-3 rounded-xs opacity-70 transition-opacity hover:opacity-100 focus:ring-2 focus:ring-offset-2 focus:outline-hidden disabled:pointer-events-none sm:top-4 sm:right-4 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4">
          <XIcon />
          <span className="sr-only">Close</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-2 text-left pr-10", className)}
      {...props}
    />
  )
}

function DialogFooter({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:items-center [&>button]:w-full sm:[&>button]:w-auto",
        className
      )}
      {...props}
    />
  )
}

function DialogTitle({
  className,
  ...props
}: ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("text-lg leading-tight font-semibold break-words", className)}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn("text-muted-foreground text-sm break-words", className)}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
