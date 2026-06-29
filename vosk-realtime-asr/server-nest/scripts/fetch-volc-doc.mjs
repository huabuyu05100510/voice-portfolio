/**
 * 复用用户登录态的 Chrome profile, 抓取火山引擎 docs 页面渲染后的纯文本.
 *
 * 前置: 用户必须 Cmd+Q 完全退出 Chrome (profile 不能被两个进程同时开).
 *
 * 用法: node scripts/fetch-volc-doc.mjs <docId> [outputFile]
 *   例: node scripts/fetch-volc-doc.mjs 82379/1394617 /tmp/liveinterpret-api.md
 *       node scripts/fetch-volc-doc.mjs 6561/1756902 /tmp/liveinterpret-2.md
 */
import { chromium } from 'playwright';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const arg = (n) => process.argv[n];
const docPath = arg(2) ?? '82379/1394617';
const outFile = arg(3) ?? `/tmp/volc-doc-${docPath.replace('/', '-')}.md`;

const url = `https://www.volcengine.com/docs/${docPath}`;
// macOS Chrome 默认 profile 路径
const profileDir = path.join(
  process.env.HOME,
  'Library/Application Support/Google/Chrome',
);
// 用一个独立 profile 子目录避免污染默认 profile 的登录态
const userDataDir = path.join('/tmp/volc-chrome-profile');

async function main() {
  console.log(`[fetch-volc-doc] URL=${url}`);
  console.log(`[fetch-volc-doc] output=${outFile}`);

  // 复制默认 profile 的 Cookies + Login Data 到 /tmp profile (如果 tmp profile 不存在)
  // 但更简单: 直接用 Default profile 子目录
  const launchOpts = {
    headless: false, // 必须非 headless, 火山引擎有反爬虫
    channel: 'chrome',
    userDataDir,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-first-run',
      '--no-default-browser-check',
    ],
    viewport: { width: 1440, height: 900 },
  };

  // 首次运行: userDataDir 不存在, 需要从默认 profile 拷贝登录态
  if (!existsSync(userDataDir)) {
    console.log('[fetch-volc-doc] first run, copying login state from default Chrome profile...');
    mkdirSync(userDataDir, { recursive: true });
    const defaultProfile = path.join(profileDir, 'Default');
    const filesToCopy = ['Cookies', 'Cookies-journal', 'Login Data', 'Login Data-journal', 'Local State'];
    const { execSync } = await import('node:child_process');
    // 拷 Local State (含加密 key)
    const localState = path.join(profileDir, 'Local State');
    if (existsSync(localState)) {
      execSync(`cp "${localState}" "${path.join(userDataDir, 'Local State')}"`);
    }
    // 拷 Default 下的登录文件到 Default 子目录
    const targetDefault = path.join(userDataDir, 'Default');
    mkdirSync(targetDefault, { recursive: true });
    for (const f of filesToCopy) {
      const src = path.join(defaultProfile, f);
      if (existsSync(src)) {
        try {
          execSync(`cp "${src}" "${path.join(targetDefault, f)}"`);
          console.log(`  copied ${f}`);
        } catch (e) {
          console.log(`  skip ${f}: ${e.message}`);
        }
      }
    }
    console.log('[fetch-volc-doc] login state copied. (若仍跳登录页, 第一次跑会让你手动登录一次, 之后保存)');
  }

  let browser;
  // 优先连用户已启动的 CDP (chrome --remote-debugging-port=9222), 避免碰 profile
  try {
    const probe = await fetch('http://localhost:9222/json/version', { signal: AbortSignal.timeout(1500) });
    if (probe.ok) {
      console.log('[fetch-volc-doc] CDP available at :9222, connecting (preserves your session)...');
      browser = await chromium.connectOverCDP('http://localhost:9222');
    }
  } catch {
    // 没有 CDP, fallback 到 launchPersistentContext
  }

  if (!browser) {
    browser = await chromium.launchPersistentContext(userDataDir, launchOpts);
  }
  const page = await browser.newPage();

  try {
    console.log('[fetch-volc-doc] navigating...');
    await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
    // 等渲染完成 (内容选择器)
    console.log('[fetch-volc-doc] waiting for content render...');
    // 火山引擎 docs 主体通常在 .markdown-body 或 [class*="doc-content"] 或 article
    await page.waitForSelector('body', { timeout: 30000 });
    // 额外等待动态内容
    await page.waitForTimeout(5000);

    // 检测是否跳到登录页
    const pageUrl = page.url();
    if (pageUrl.includes('login') || pageUrl.includes('passport')) {
      console.log(`[fetch-volc-doc] redirected to login page: ${pageUrl}`);
      console.log('[fetch-volc-doc] 请在打开的浏览器窗口里手动登录, 登录完成后按 Enter 继续...');
      await new Promise((resolve) => process.stdin.once('data', resolve));
      await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
      await page.waitForTimeout(5000);
    }

    // 提取文本
    const content = await page.evaluate(() => {
      // 优先选文档主体容器
      const selectors = [
        '.markdown-body',
        '[class*="doc-content"]',
        '[class*="DocContent"]',
        'article',
        'main',
        '.arco-layout-content',
      ];
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el && el.innerText.length > 500) {
          return { selector: sel, text: el.innerText, html: el.innerHTML };
        }
      }
      // fallback: 整页
      return { selector: 'body', text: document.body.innerText, html: document.body.innerHTML };
    });

    console.log(`[fetch-volc-doc] selector hit: ${content.selector}`);
    console.log(`[fetch-volc-doc] text length: ${content.text.length}`);

    if (content.text.length < 200) {
      console.log('[fetch-volc-doc] WARN: 内容过短, 可能未渲染. 保存 HTML 供检查.');
      writeFileSync(outFile + '.html', content.html);
      writeFileSync(outFile, content.text);
    } else {
      writeFileSync(outFile, content.text);
      writeFileSync(outFile + '.html', content.html);
      console.log(`[fetch-volc-doc] ✓ saved text to ${outFile}`);
      console.log(`[fetch-volc-doc] ✓ saved html to ${outFile}.html`);
      // 预览前 1500 字
      console.log('\n=== PREVIEW (first 1500 chars) ===');
      console.log(content.text.slice(0, 1500));
    }
  } catch (e) {
    console.error('[fetch-volc-doc] ERROR:', e.message);
    // 失败也存截图
    try {
      await page.screenshot({ path: outFile + '.png', fullPage: true });
      console.log(`[fetch-volc-doc] screenshot saved: ${outFile}.png`);
    } catch {}
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
