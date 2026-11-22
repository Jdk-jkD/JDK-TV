'use client';

import Link from 'next/link';
import { useAuth } from '@/components/auth';

/** 本项目版本独立显示；上游来源和许可证集中在关于页面。 */
export function SiteFooter() {
  const { version } = useAuth();
  return (
    <footer className="border-t border-line py-4">
      <p className="text-center text-xs text-faint">
        <Link href="/about" className="hover:text-accent">
          JDK TV{version ? ` v${version}` : ''}
        </Link>
        {' · '}AGPL-3.0 License
      </p>
    </footer>
  );
}
