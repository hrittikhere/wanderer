'use client';

import Link from 'next/link';
import { type Talk, type LinkComponentProps } from '@wanderer/talks';
import { Wanderer } from '@wanderer/talks/globe';

function AppLink({ href, children, ...rest }: LinkComponentProps) { return <Link href={href} {...rest}>{children}</Link>; }
export function TalksClient({ talks, referenceDate }: { talks: Talk[]; referenceDate: string }) {
  return <Wanderer talks={talks} referenceDate={referenceDate} globe={{ intro: false }} navigation={{ LinkComponent: AppLink }} />;
}
