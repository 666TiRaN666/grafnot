import type { RouteSection } from './ui/router';
export type AddMode = 'section' | 'note' | 'choose';
export type AddAction = 'note' | 'task' | 'prompt' | 'choose';
export type ContextTab = 'links' | 'tasks' | 'prompts';
export interface NoteSession { from: number; to: number; scroll: number; tab: ContextTab; open: boolean; returnFocus: boolean }
export interface PromptTarget { profileId: string; epoch: number; noteId: string }
export const canPinContext = (width: number): boolean => width >= 300 + 320 + 560 + 48;
export const mobileAddAction = (section: RouteSection, mode: AddMode): AddAction =>
  mode === 'choose' ? 'choose' : mode === 'note' ? 'note' : section === 'plan' ? 'task' : section === 'prompts' ? 'prompt' : 'note';
export const promptTargetMatches = (a: PromptTarget, b: PromptTarget): boolean =>
  a.profileId === b.profileId && a.epoch === b.epoch && a.noteId === b.noteId;
