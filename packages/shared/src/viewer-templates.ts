/** Supported public presentation choices. Older stored templates keep the default. */
export const VIEWER_TEMPLATES = [
  { value: 'cyber_arcade', name: 'Channel guide', description: 'The supplied light viewer dashboard, with a welcome guide and community overview.' },
  { value: 'spotlight', name: 'Spotlight', description: 'The viewer dashboard with a top-three podium, player monograms and compact standings.' },
] as const;

export function resolveViewerTemplate(value: unknown) {
  return VIEWER_TEMPLATES.find(template => template.value === value) || VIEWER_TEMPLATES[0];
}
