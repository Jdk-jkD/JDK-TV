'use client';

import { Header } from '@/components/header';
import { SiteFooter } from '@/components/site-footer';

export default function AboutPage() {
  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 max-w-2xl w-full mx-auto px-4 py-10 space-y-8">
        <section>
          <h1 className="text-xl font-bold text-content mb-3">关于JDK TV</h1>
          <p className="text-sm text-muted leading-relaxed">
            JDK TV 是一个免费的在线视频搜索与观看平台。输入片名即可在多个点播源中聚合搜索，
            本机使用无需注册、无内嵌广告。播放内容来自第三方接口，可按设置在本设备缓存片段或下载视频。
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-content mb-2.5">快捷键</h2>
          <ul className="text-sm text-muted space-y-1.5 list-disc list-inside">
            <li><code className="text-accent">空格</code> 播放 / 暂停</li>
            <li><code className="text-accent">←</code> / <code className="text-accent">→</code> 点按快退 / 快进 5 秒，按住临时 3 倍速</li>
            <li><code className="text-accent">↑</code> / <code className="text-accent">↓</code> 音量调节</li>
            <li><code className="text-accent">F</code> 切换全屏</li>
            <li><code className="text-accent">Alt + ←/→</code> 上一集 / 下一集</li>
            <li>移动端长按视频可 3 倍速播放</li>
          </ul>
        </section>

        <section>
          <h2 className="text-base font-semibold text-content mb-2.5">隐私与数据</h2>
          <p className="text-sm text-muted leading-relaxed">
            你的搜索历史、观看进度等数据仅保存在本设备浏览器中（IndexedDB），不会上传到服务器。
            搜索词和播放请求会发送到相关数据源。经代理的请求由服务端访问上游，直接加载的图片等资源可能由本设备访问。
            本机部署时，服务端通常与本设备共用网络出口。缓存与下载保存在本设备，备份文件不包含视频内容。
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-content mb-2.5">免责声明</h2>
          <p className="text-sm text-faint leading-relaxed">
            本项目不存储、不制作任何视频内容，仅提供第三方公开接口的聚合与播放能力。
            请尊重版权，所有内容的合法性由对应数据源负责。
          </p>
        </section>
        <section>
          <h2 className="text-base font-semibold text-content mb-2.5">开源许可与来源</h2>
          <p className="text-sm text-muted leading-relaxed">
            JDK TV 基于 <a href="https://github.com/LibreSpark/LibreTV" target="_blank" rel="noopener noreferrer" className="text-accent">LibreSpark/LibreTV</a> 二次开发，
            保留原项目版权及贡献者署名，采用 <a href="/AGPL-3.0.txt" className="text-accent">AGPL-3.0-or-later</a> 许可证。
            上游更新需经过本项目审查和验证，再决定是否采用。
          </p>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
