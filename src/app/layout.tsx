import type { Metadata, Viewport } from 'next';
import './globals.css';
import { Providers } from '@/components/providers';

export const metadata: Metadata = {
  title: {
    default: 'JDK TV',
    template: '%s - JDK TV',
  },
  description:
    'JDK TV 个人影视发现与播放工具。',
  manifest: '/manifest.webmanifest',
  // 同一张品牌图标导出的多尺寸，供浏览器和桌面入口使用。
  // 只声明单张 512 时，抓取端只能拿大图缩放，小尺寸下易糊、看起来「没填满」。
  icons: {
    icon: [
      { url: '/favicon.ico?v=jdk-tv' },
      { url: '/icons/icon-96.png?v=jdk-tv', sizes: '96x96', type: 'image/png' },
      { url: '/icons/icon-192.png?v=jdk-tv', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon-512.png?v=jdk-tv', sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: '/icons/apple-touch-icon.png?v=jdk-tv', sizes: '180x180', type: 'image/png' }],
  },
};

export const viewport: Viewport = {
  themeColor: '#0b101a',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        {/* 首屏前同步主题，避免亮暗闪烁 */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "(function(){try{var t=localStorage.getItem('libretv-theme')||'dark';var d=t==='dark'||(t==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d);}catch(e){}})()",
          }}
        />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
