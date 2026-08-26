import type { NextConfig } from 'next';

const config: NextConfig = {
  // pg는 서버에서만 쓴다. 번들에 끌어넣지 않는다.
  serverExternalPackages: ['pg'],
};

export default config;
