import { ComponentProps } from "react"
import { DayPicker } from "react-day-picker"
import { ptBR } from "react-day-picker/locale"

import { cn } from "@/utils"
import { buttonVariants } from "@/button"

function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  locale = ptBR,
  captionLayout = "dropdown",
  fromYear,
  toYear,
  weekStartsOn = 1,
  ...props
}: ComponentProps<typeof DayPicker>) {
  const nowYear = new Date().getFullYear()
  const safeFromYear = fromYear ?? nowYear - 10
  const safeToYear = toYear ?? nowYear + 15
  const hideCaptionLabel = captionLayout === 'dropdown'
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn("p-3", className)}
      locale={locale}
      captionLayout={captionLayout}
      fromYear={safeFromYear}
      toYear={safeToYear}
      weekStartsOn={weekStartsOn}
      classNames={{
        root: cn("p-0", classNames?.root),
        months: cn("flex flex-col sm:flex-row gap-2", classNames?.months),
        month: cn("space-y-4", classNames?.month),
        month_caption: cn("flex justify-center pt-1 relative items-center w-full", classNames?.month_caption),
        caption_label: cn(hideCaptionLabel ? "sr-only" : "text-sm font-medium", classNames?.caption_label),
        dropdowns: cn("flex items-center gap-2", classNames?.dropdowns),
        dropdown_root: cn("relative", classNames?.dropdown_root),
        dropdown: cn(
          "h-8 rounded-md border border-white/10 bg-black/20 px-2 text-sm text-white",
          "focus:outline-none focus:ring-2 focus:ring-brand-500/20",
          classNames?.dropdown
        ),
        months_dropdown: cn("min-w-32", classNames?.months_dropdown),
        years_dropdown: cn("min-w-24", classNames?.years_dropdown),
        nav: cn("flex items-center gap-1", classNames?.nav),
        button_previous: cn(
          buttonVariants({ variant: "outline" }),
          "h-7 w-7 bg-transparent p-0 opacity-70 hover:opacity-100 absolute left-1",
          classNames?.button_previous
        ),
        button_next: cn(
          buttonVariants({ variant: "outline" }),
          "h-7 w-7 bg-transparent p-0 opacity-70 hover:opacity-100 absolute right-1",
          classNames?.button_next
        ),
        month_grid: cn("w-full border-collapse space-y-1", classNames?.month_grid),
        weekdays: cn("flex", classNames?.weekdays),
        weekday: cn("text-muted-foreground rounded-md w-9 font-normal text-[0.8rem] text-center", classNames?.weekday),
        weeks: cn("w-full", classNames?.weeks),
        week: cn("flex w-full mt-2", classNames?.week),
        day: cn(
          "relative p-0 text-center text-sm focus-within:relative focus-within:z-20",
          "[&:has([aria-selected])]:bg-accent [&:has([aria-selected])]:rounded-md",
          classNames?.day
        ),
        day_button: cn(
          buttonVariants({ variant: "ghost" }),
          "h-9 w-9 p-0 font-normal aria-selected:opacity-100",
          "aria-selected:bg-primary aria-selected:text-primary-foreground",
          "hover:bg-white/10",
          classNames?.day_button
        ),
        week_number: cn("text-muted-foreground w-9 text-xs", classNames?.week_number),
        week_number_header: cn("text-muted-foreground w-9 text-xs", classNames?.week_number_header),
        chevron: cn("h-4 w-4", classNames?.chevron),
      }}
      labels={{
        labelMonthDropdown: () => "Mês",
        labelYearDropdown: () => "Ano",
        labelNext: () => "Próximo mês",
        labelPrevious: () => "Mês anterior",
      }}
      {...props}
    />
  )
}

export { Calendar }
