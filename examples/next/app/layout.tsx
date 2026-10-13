import type { ReactNode } from 'react';
import '@wanderer/talks/styles.css';

export const metadata = { title: 'Wanderer · Next.js example', description: 'Server-rendered speaking history with an optional globe.' };
export default function Layout({ children }: { children: ReactNode }) {
  return <html lang="en"><body style={{ margin: '2rem', fontFamily: 'system-ui' }}>{children}</body></html>;
}
