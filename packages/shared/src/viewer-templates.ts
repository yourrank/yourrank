/** Supported public presentation. Older stored templates resolve to the canonical community shell. */
export const VIEWER_TEMPLATES = [
  { value: 'cyber_arcade', name: 'Community hub', description: 'The supplied community experience: a creator rail, daily activities, standings, rewards and member activity.' },
] as const;

export function resolveViewerTemplate(value: unknown) {
  return VIEWER_TEMPLATES.find(template => template.value === value) || VIEWER_TEMPLATES[0];
}
