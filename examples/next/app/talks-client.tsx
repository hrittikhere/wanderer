'use client';

import Link from 'next/link';
import { Talks, type Talk, type LinkComponentProps } from '@wanderer/talks';
import { globeView } from '@wanderer/talks/globe';

const views = [globeView({ presentation: 'immersive', intro: false })];
function AppLink({ href, children, ...rest }: LinkComponentProps) { return <Link href={href} {...rest}>{children}</Link>; }
export function TalksClient({ talks, referenceDate }: { talks: Talk[]; referenceDate: string }) {
  return <Talks talks={talks} referenceDate={referenceDate} views={views} navigation={{ LinkComponent: AppLink }} />;
}
