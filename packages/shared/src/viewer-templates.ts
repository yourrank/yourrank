/** Supported public presentation choices. Older stored templates keep the default. */
export const VIEWER_TEMPLATES = [
  { value: 'cyber_arcade', name: 'Channel guide', description: 'The current light layout, with a blue community sidebar and simple records.' },
  { value: 'spotlight', name: 'Spotlight', description: 'A dark stage with a top-three podium, player monograms, compact standings, and navigation across the top.' },
] as const;

export function resolveViewerTemplate(value: unknown) {
  return VIEWER_TEMPLATES.find(template => template.value === value) || VIEWER_TEMPLATES[0];
}
