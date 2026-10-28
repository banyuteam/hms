import {
  Bell,
  ChevronDown,
  ClipboardList,
  Eye,
  EyeOff,
  FileText,
  FlaskConical,
  House,
  Image as ImageIcon,
  LayoutGrid,
  Lock,
  LogOut,
  Maximize2,
  Minimize2,
  Minus,
  Plus,
  Receipt,
  Search,
  TriangleAlert,
  Users,
  X,
  type LucideProps,
} from 'lucide-react';

const ICONS = {
  bell: Bell,
  chevronDown: ChevronDown,
  clipboard: ClipboardList,
  eye: Eye,
  eyeOff: EyeOff,
  file: FileText,
  flask: FlaskConical,
  home: House,
  image: ImageIcon,
  grid: LayoutGrid,
  lock: Lock,
  logout: LogOut,
  maximize: Maximize2,
  restore: Minimize2,
  minus: Minus,
  plus: Plus,
  receipt: Receipt,
  search: Search,
  alert: TriangleAlert,
  users: Users,
  x: X,
} as const;

export type IconName = keyof typeof ICONS;

/** Lucide icons (ISC), 2px stroke, imported per icon so the bundle stays small. Decorative by default. */
export function Icon({
  name,
  size = 20,
  ...props
}: { name: IconName; size?: number } & LucideProps) {
  const Cmp = ICONS[name];
  return <Cmp size={size} strokeWidth={2} aria-hidden="true" focusable="false" {...props} />;
}
