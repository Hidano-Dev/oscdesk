export const SAMPLE_DEFINITION = {
  format: 'oscdesk-surface',
  version: 1,
  name: 'Stage',
  parameters: [
    { id: 'master', address: '/mix/master', label: 'Master', type: 'f', kind: 'state', range: [0, 1], default: 0.5 },
  ],
  screens: [{ id: 'main', label: 'Main', children: [{ kind: 'control', param: 'master', widget: 'slider' }] }],
}
