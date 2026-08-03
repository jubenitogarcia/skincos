import { ChevronDown, ChevronUp } from 'lucide-react'
import { Button } from '@/button'
import { TooltipButton } from '@/tooltip'

type PanelToggleButtonProps = {
  expanded: boolean
  onToggle: () => void
  expandedLabel?: string
  collapsedLabel?: string
  ariaControls?: string
  testId?: string
}

/**
 * Matches the collapse affordance used by Insumos: a fixed icon control in
 * the header, with the state exposed by its tooltip and ARIA attributes.
 */
export function PanelToggleButton({
  expanded,
  onToggle,
  expandedLabel = 'Contrair',
  collapsedLabel = 'Expandir',
  ariaControls,
  testId,
}: PanelToggleButtonProps) {
  const label = expanded ? expandedLabel : collapsedLabel

  return (
    <TooltipButton label={label}>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        className="h-9 w-9 bg-transparent text-white hover:bg-white/[0.10] focus-visible:ring-sky-300/60"
        onClick={onToggle}
        aria-label={label}
        aria-expanded={expanded}
        aria-controls={ariaControls}
        data-testid={testId}
        data-panel-toggle="true"
      >
        {expanded ? <ChevronUp className="h-4 w-4" aria-hidden="true" /> : <ChevronDown className="h-4 w-4" aria-hidden="true" />}
      </Button>
    </TooltipButton>
  )
}
