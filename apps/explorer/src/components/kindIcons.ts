import {
  Activity,
  AlertTriangle,
  Bot,
  CircleDot,
  Code2,
  FileCheck2,
  GitBranch,
  KeyRound,
  RefreshCcw,
  ShieldCheck,
  UserRound,
  type LucideIcon,
} from 'lucide-react';
import type { EventKind } from '../types';

export const kindIcons: Record<EventKind, LucideIcon> = {
  intent: UserRound,
  proposal: Bot,
  transformation: GitBranch,
  approval: KeyRound,
  implementation: Code2,
  test: FileCheck2,
  verification: ShieldCheck,
  challenge: AlertTriangle,
  revision: RefreshCcw,
  observation: Activity,
  event: CircleDot,
};
