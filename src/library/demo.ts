import { SCHEMA_VERSION, type TapeMeta } from './schema';

export const DEMO_ID = 'studio-demo';

/** The built-in tape: two original recordings synthesised by scripts/make-demo-audio.mjs. */
export const DEMO_TAPE: TapeMeta = {
  schema: SCHEMA_VERSION,
  id: DEMO_ID,
  title: 'Studio Demo',
  note: 'Recorded for Cassette Study',
  color: '#f3efe6',
  template: 'index',
  artKey: null,
  sides: {
    A: { label: 'Glass Morning', audioKey: null, audioName: 'side-a.m4a', duration: 48.2 },
    B: { label: 'Night Index', audioKey: null, audioName: 'side-b.m4a', duration: 41.8 },
  },
  createdAt: 0,
  updatedAt: 0,
  builtIn: true,
};

export const DEMO_URLS = { A: '/audio/side-a.m4a', B: '/audio/side-b.m4a' } as const;
