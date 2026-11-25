// View icons: the app icon ids views declare in `config.icon` (miso's
// lib/app-icons.ts), mapped to Tabler icons. Unknown ids fall back to a file.
// The same map draws the symbols a space can carry (app/lib/symbols.ts).
import {
  IconActivity,
  IconAtom,
  IconBell,
  IconBook,
  IconBriefcase,
  IconBuilding,
  IconBuildingFactory2,
  IconBulb,
  IconCalendar,
  IconChartBar,
  IconCloud,
  IconCode,
  IconCoin,
  IconCompass,
  IconDatabase,
  IconFile,
  IconFlag,
  IconFlask,
  IconFolder,
  IconHeart,
  IconHome,
  IconLeaf,
  IconMail,
  IconMap,
  IconMessage,
  IconPalette,
  IconPuzzle,
  IconRocket,
  IconSettings,
  IconSoup,
  IconSparkles,
  IconStar,
  IconTarget,
  IconTool,
  IconTrophy,
  IconTruck,
  IconUser,
  IconUsers,
  IconVault,
  IconWorld,
  type TablerIcon
} from '@tabler/icons-react'

import type { Space } from '../../lib/types'
import { isSymbol, type SymbolId } from '../../lib/symbols'

export const ICONS: Record<SymbolId, TablerIcon> = {
  activity: IconActivity,
  atom: IconAtom,
  bell: IconBell,
  book: IconBook,
  briefcase: IconBriefcase,
  building: IconBuilding,
  bulb: IconBulb,
  calendar: IconCalendar,
  chart: IconChartBar,
  cloud: IconCloud,
  code: IconCode,
  coin: IconCoin,
  compass: IconCompass,
  database: IconDatabase,
  factory: IconBuildingFactory2,
  file: IconFile,
  flag: IconFlag,
  flask: IconFlask,
  folder: IconFolder,
  heart: IconHeart,
  home: IconHome,
  leaf: IconLeaf,
  mail: IconMail,
  map: IconMap,
  message: IconMessage,
  palette: IconPalette,
  puzzle: IconPuzzle,
  rocket: IconRocket,
  settings: IconSettings,
  soup: IconSoup,
  sparkles: IconSparkles,
  star: IconStar,
  target: IconTarget,
  tool: IconTool,
  trophy: IconTrophy,
  truck: IconTruck,
  user: IconUser,
  users: IconUsers,
  vault: IconVault,
  world: IconWorld
}

export function viewIcon(id: string | undefined): TablerIcon {
  return (id && ICONS[id as SymbolId]) || IconFile
}

// Space icons: the symbol an admin picked, else a line icon per space folder, drawn in the text
// colour like the other sidebar rows. A space with neither gets a folder.
const SPACE_ICONS: Record<string, TablerIcon> = {
  factory: IconBuildingFactory2,
  miso: IconSoup,
  vault: IconVault
}

export function spaceIcon(space: Pick<Space, 'folder' | 'symbol'>): TablerIcon {
  return (isSymbol(space.symbol) && ICONS[space.symbol]) || (space.folder && SPACE_ICONS[space.folder]) || IconFolder
}
