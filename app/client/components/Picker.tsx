// A button naming what's picked, opening a list of checkboxes.
import { IconChevronDown } from '@tabler/icons-react'
import { Button } from '../ui/button'
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuTrigger } from '../ui/dropdown-menu'

export type PickerOption = { id: string; label: string; disabled?: boolean }

type PickerProps = {
  label: string
  // Shown on the button instead of the picked names; the label is then only read out.
  text?: string
  empty: string
  none: string
  // What to call a picked id that has no option any more (a deleted department or person).
  gone: string
  options: PickerOption[]
  selected: string[]
  disabled: boolean
  onToggle: (id: string, on: boolean) => void
}

export function Picker({ label, text, empty, none, gone, options, selected, disabled, onToggle }: PickerProps) {
  // Kept in the list so a stale pick is seen and can be unticked, instead of staying in the rule unseen.
  const all: PickerOption[] = [...options, ...selected.filter(id => !options.some(o => o.id === id)).map(id => ({ id, label: gone }))]
  const names = all.filter(o => selected.includes(o.id)).map(o => o.label)
  return (
    <div className="flex min-w-0 flex-col gap-1">
      {!text && <span className="text-xs text-muted-foreground">{label}</span>}
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="outline" size="sm" className="w-44 justify-between font-normal" disabled={disabled} aria-label={text ? label : `${label}: ${names.join(', ') || none}`} />}
        >
          <span className="truncate">{text ?? (names.length ? names.join(', ') : none)}</span>
          <IconChevronDown stroke={1.75} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align={text ? 'end' : 'start'} className="max-h-80 w-56 overflow-y-auto">
          {all.length === 0 && <p className="px-2 py-1.5 text-xs text-muted-foreground">{empty}</p>}
          {all.map(option => (
            <DropdownMenuCheckboxItem
              key={option.id}
              checked={selected.includes(option.id)}
              disabled={option.disabled || disabled}
              closeOnClick={false}
              onCheckedChange={on => onToggle(option.id, on)}
            >
              {option.label}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
