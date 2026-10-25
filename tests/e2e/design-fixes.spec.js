import { test, expect, mockSupabase } from './guard.js';

const WIDTHS = [375, 768, 1440];

function contrast(fg, bg) {
  const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const lum = (rgb) => 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
  const light = Math.max(lum(fg), lum(bg));
  const dark = Math.min(lum(fg), lum(bg));
  return (light + 0.05) / (dark + 0.05);
}

async function fit(page) {
  return page.evaluate(() => {
    const offFlow = (el) => {
      for (let node = el; node && node !== document.body && node !== document.documentElement; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (style.position === 'fixed') return true;
        if (node !== el && /hidden|clip/.test(style.overflowX + ' ' + style.overflow)) return true;
      }
      return false;
    };
    const spill = [];
    for (const el of document.querySelectorAll('body *')) {
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || offFlow(el)) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width <= 1 || rect.height <= 1) continue;
      if (rect.right > window.innerWidth + 2 || rect.left < -2) {
        spill.push((el.id || el.tagName) + ' ' + Math.round(rect.left) + '..' + Math.round(rect.right));
      }
    }
    return {
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
      spill,
    };
  });
}

test('home keeps one headline colour, sentence-case labels, and no sideways scroll', async ({ page }) => {
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    await page.evaluate(() => document.fonts && document.fonts.ready);
    const box = await fit(page);
    expect(box.scrollWidth, width + ' scrollWidth').toBeLessThanOrEqual(box.innerWidth + 1);
    expect(box.spill, width + ' spill').toEqual([]);

    const home = await page.evaluate(() => {
      const channels = (value) => value.match(/[\d.]+/g).slice(0, 3).map(Number).map((n) => n / 255);
      const read = (el) => {
        const style = getComputedStyle(el);
        return {
          text: el.textContent.trim(),
          size: parseFloat(style.fontSize),
          transform: style.textTransform,
          color: channels(style.color),
          background: channels(style.backgroundColor),
        };
      };
      const title = document.querySelector('.hero-title');
      return {
        title: title.textContent.replace(/\s+/g, ' ').trim(),
        titleColor: channels(getComputedStyle(title).color),
        titleSpans: title.querySelectorAll('span').length,
        scrollCue: document.querySelectorAll('.scroll-hint, #scrollHint').length,
        eyebrow: read(document.querySelector('.hero-eyebrow')),
        section: read(document.querySelector('.section-label')),
        primary: read(document.querySelector('.btn-primary')),
        ghost: read(document.querySelector('.btn-ghost')),
        cta: read(document.querySelector('.nav-cta')),
      };
    });

    expect(home.title).toContain('Campaigns, leaderboards');
    expect(home.title).toContain('Simple.');
    expect(home.titleSpans).toBe(0);
    expect(home.titleColor.map((n) => Math.round(n * 255))).toEqual([242, 242, 244]);
    expect(home.scrollCue).toBe(0);
    expect(home.eyebrow.text).toBe('Built for Solana meme projects');
    expect(home.section.text).toBe('What Bard does');
    expect(home.primary.text).toBe('Launch app');
    expect(home.ghost.text).toBe('For projects');
    for (const label of [home.eyebrow, home.section, home.primary, home.ghost]) {
      expect(label.size, label.text).toBeGreaterThanOrEqual(14);
      expect(label.transform, label.text).toBe('none');
      const bg = label.background[0] + label.background[1] + label.background[2] === 0
        ? [12 / 255, 12 / 255, 15 / 255]
        : label.background;
      expect(contrast(label.color, bg), label.text).toBeGreaterThanOrEqual(4.5);
    }
    expect(home.cta.text).toBe('Launch app');
    expect(home.cta.color.map((n) => Math.round(n * 255))).toEqual([12, 12, 15]);
    expect(home.cta.background.map((n) => Math.round(n * 255))).toEqual([155, 127, 232]);
    expect(contrast(home.cta.color, home.cta.background)).toBeGreaterThanOrEqual(4.5);
    if (width > 768) {
      expect(home.cta.size).toBeGreaterThanOrEqual(14);
      expect(home.cta.transform).toBe('none');
    }
  }
});

test('home corner logo and tab icon have no black plate', async ({ page, request }) => {
  const icon = await request.get('/favicon.png');
  expect(icon.status()).toBe(200);
  expect(icon.headers()['content-type'] || '').toContain('image/png');

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute('href', '/favicon.png');

  const readMark = async (selector) => page.locator(selector).evaluate(async (img) => {
    if (!img.complete || !img.naturalWidth) {
      await new Promise((resolve, reject) => {
        img.addEventListener('load', resolve, { once: true });
        img.addEventListener('error', () => reject(new Error('logo failed to load')), { once: true });
      });
    }
    const style = getComputedStyle(img);
    const canvas = document.createElement('canvas');
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0);
    const at = (x, y) => Array.from(ctx.getImageData(x, y, 1, 1).data);
    return {
      src: img.getAttribute('src'),
      radius: style.borderRadius,
      background: style.backgroundColor,
      box: [Math.round(img.getBoundingClientRect().width), Math.round(img.getBoundingClientRect().height)],
      corners: [at(0, 0), at(w - 1, 0), at(0, h - 1), at(w - 1, h - 1)],
    };
  });

  for (const selector of ['.nav-logo img', '.footer-logo img']) {
    const mark = await readMark(selector);
    expect(mark.src, selector).toBe('/transparentbardsmile.png');
    expect(mark.radius, selector).toBe('0px');
    expect(mark.background, selector).toBe('rgba(0, 0, 0, 0)');
    expect(mark.box[0], selector).toBeGreaterThan(mark.box[1]);
    for (const pixel of mark.corners) expect(pixel[3], selector).toBe(0);
  }
});

test('campaigns and join pages have no public label and no dashed empty box', async ({ page }) => {
  await mockSupabase(page, {});
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/explore.html');
    await expect(page.locator('.kicker')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Explore campaigns' })).toBeVisible();
    const empty = page.locator('.empty');
    await expect(empty).toBeVisible();
    await expect(empty).toContainText('No live campaigns');
    await expect(empty.getByRole('link', { name: 'Open team admin' })).toBeVisible();
    await expect(empty.locator('a, button')).toHaveCount(1);
    const border = await empty.evaluate((el) => getComputedStyle(el).borderTopStyle);
    expect(border).not.toBe('dashed');
    const exploreFit = await fit(page);
    expect(exploreFit.scrollWidth, 'explore ' + width).toBeLessThanOrEqual(exploreFit.innerWidth + 1);
    expect(exploreFit.spill, 'explore spill ' + width).toEqual([]);

    await page.goto('/dashboard.html');
    await page.getByRole('button', { name: 'Browse without connecting' }).click();
    const joinEmpty = page.locator('#page-overview .empty');
    await expect(joinEmpty).toBeVisible();
    await expect(joinEmpty).toContainText('No live campaigns yet');
    await expect(joinEmpty.getByRole('link', { name: 'Open team admin' })).toBeVisible();
    await expect(joinEmpty.locator('a, button')).toHaveCount(1);
    const joinBorder = await joinEmpty.evaluate((el) => getComputedStyle(el).borderTopStyle);
    expect(joinBorder).not.toBe('dashed');
    const joinFit = await fit(page);
    expect(joinFit.scrollWidth, 'join ' + width).toBeLessThanOrEqual(joinFit.innerWidth + 1);
    expect(joinFit.spill, 'join spill ' + width).toEqual([]);
  }
});
