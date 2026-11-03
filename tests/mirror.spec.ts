import { test, expect } from '@playwright/test';
import type { Page, Route } from '@playwright/test';
import fs from 'node:fs';

// mirror in each browser, against a stand-in app server and worker (Playwright's request routing): the shell for
// every path under /app/, the built modules under /src/, and the worker under /worker/, all on one origin.
// localhost: a secure context, as crypto.subtle (the app's key) needs. Nothing listens there: requests are routed.
const ORIGIN = 'http://localhost:4319';
const root = new URL('../', import.meta.url);
const shell = fs.readFileSync(new URL('tests/data/shell.html', root), 'utf8');

const products: Record<string, { title: string }> = { 1: { title: 'Bag' }, 2: { title: 'Hat' } };

/** A fragment as o2h-edge returns it: HTML, then the VM, embedded. */
const fragment = (html: string, vm: unknown) => `${html}<script type="application/json" data-tree="tree">${JSON.stringify(vm)}</script>`;
const list = () => fragment(
    `<ul>${Object.entries(products).map(([id, { title }]) => `<li><a href="products/${id}">${title}</a></li>`).join('')}</ul>`,
    { data: Object.values(products), route: {} });

interface Worker { installs: string[]; renders: string[]; lose: boolean }

async function serve(page: Page): Promise<Worker> {
    const worker: Worker = { installs: [], renders: [], lose: false };
    await page.route(`${ORIGIN}/**`, async (route: Route) => {
        const request = route.request();
        const { pathname } = new URL(request.url());
        if (pathname.startsWith('/src/')) {
            const file = new URL(pathname.slice('/src/'.length), root);
            return fs.existsSync(file) ? route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(file, 'utf8') }) : route.fulfill({ status: 404 });
        }
        const app = /^\/worker\/o2h-app\/([^/]+)(\/.*)?$/.exec(pathname);
        if (app) {
            const [, key, path] = app;
            if (path === undefined) {
                worker.installs.push(key);
                worker.lose = false;
                return route.fulfill({ status: 204 });
            }
            worker.renders.push(path);
            const json = (status: number, body: unknown, headers = {}) => route.fulfill({ status, contentType: 'application/json', headers, body: JSON.stringify(body) });
            if (worker.lose) return json(404, { error: `no app "${key}"` });
            if (path === '/') return route.fulfill({ contentType: 'text/html; charset=utf-8', body: list() });
            const id = /^\/products\/(\d+)$/.exec(path)?.[1];
            if (id === '9') return json(200, { data: { title: 'Passed back' }, route: { id } }, { 'X-O2H-Error': 'rendering failed (test)' });
            if (!id || !products[id]) return json(404, { error: 'the source "data": the API answered 404' });
            return route.fulfill({
                contentType: 'text/html; charset=utf-8',
                body: fragment(`<article><h2>${products[id].title}</h2><a href="./">All</a> <a href="products/${id}">This</a></article>`, { data: products[id], route: { id } }),
            });
        }
        if (pathname.startsWith('/app')) return route.fulfill({ contentType: 'text/html; charset=utf-8', body: shell });
        return route.fulfill({ status: 404 });
    });
    return worker;
}

const lastRender = (page: Page) => page.evaluate(() => (window as any).renders.at(-1));
const renders = (page: Page) => page.evaluate(() => (window as any).renders.length);
const hasNavigation = (page: Page) => page.evaluate(() => 'navigation' in window);

test('renders the current path: installs the app once, inserts the fragment, hydrates it, sets the title', async ({ page }) => {
    const worker = await serve(page);
    await page.goto(`${ORIGIN}/app/products/2`);
    await expect(page.locator('main h2')).toHaveText('Hat');
    expect(await lastRender(page)).toMatchObject({ path: '/products/2', by: 'worker', route: 1, pending: 0, vm: { route: { id: '2' } } });
    await expect(page.locator('main')).toHaveAttribute('data-hydrated', '{"id":"2"}');
    await expect(page).toHaveTitle('Hat');
    expect(worker.installs).toHaveLength(1);
    expect(worker.installs[0]).toMatch(/^app-[0-9a-f]{32}$/);
    // Links to the current page are marked, others aren't
    await expect(page.locator('main a[href="products/2"]')).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('main a[href="./"]')).not.toHaveAttribute('aria-current', 'page');
});

test('in-app links render through the worker, Back and Forward too, without loading the document again', async ({ page }) => {
    const worker = await serve(page);
    await page.goto(`${ORIGIN}/app/`);
    await expect(page.locator('main li')).toHaveCount(2);
    await expect(page).toHaveTitle('Home');
    const intercepted = await hasNavigation(page);

    await page.locator('main a', { hasText: 'Bag' }).click();
    await expect(page.locator('main h2')).toHaveText('Bag');
    expect(page.url()).toBe(`${ORIGIN}/app/products/1`);
    await expect(page).toHaveTitle('Bag');

    await page.goBack();
    await expect(page.locator('main li')).toHaveCount(2);
    expect(page.url()).toBe(`${ORIGIN}/app/`);
    await page.goForward();
    await expect(page.locator('main h2')).toHaveText('Bag');

    expect(worker.renders).toEqual(['/', '/products/1', '/', '/products/1']);
    // With the Navigation API, the shell loaded once; without it, links are ordinary navigations (the shell loads again)
    const loads = await page.evaluate(() => (window as any).loads);
    if (intercepted) expect(loads).toBe(1);
    else expect(loads).toBeGreaterThan(1);
    expect(worker.installs).toHaveLength(intercepted ? 1 : loads);
});

test('the worker lost the app: it is installed again, once', async ({ page }) => {
    const worker = await serve(page);
    await page.goto(`${ORIGIN}/app/`);
    await expect(page.locator('main li')).toHaveCount(2);
    worker.lose = true;
    await page.evaluate(() => (window as any).store.refresh());
    await expect.poll(() => renders(page)).toBe(2);
    expect(await lastRender(page)).toMatchObject({ by: 'worker', path: '/' });
    expect(worker.installs).toHaveLength(2);
});

test('the worker passes the VM back: the page renders it', async ({ page }) => {
    await serve(page);
    await page.goto(`${ORIGIN}/app/products/9`);
    await expect(page.locator('main .page-rendered')).toHaveText('Passed back');
    expect(await lastRender(page)).toMatchObject({ by: 'page', error: 'rendering failed (test)' });
    await expect(page).toHaveTitle('Passed back');
});

test('the shell opened by its file name (index.html) renders the base', async ({ page }) => {
    const worker = await serve(page);
    await page.goto(`${ORIGIN}/app/index.html`);
    await expect(page.locator('main li')).toHaveCount(2);
    expect(await lastRender(page)).toMatchObject({ by: 'worker', path: '/' });
    expect(worker.renders).toEqual(['/']);
});

test('failures are reported, and the container is left as it was', async ({ page }) => {
    await serve(page);
    await page.goto(`${ORIGIN}/app/products/404`);
    await expect.poll(() => renders(page)).toBe(1);
    expect(await lastRender(page)).toMatchObject({ by: 'none', error: '404 the source "data": the API answered 404' });
    await page.goto(`${ORIGIN}/app/carts/1`);
    await expect.poll(() => renders(page)).toBe(1);
    expect(await lastRender(page)).toMatchObject({ by: 'none', error: 'no route of the app matches "/carts/1"' });
    await expect(page.locator('main')).toBeEmpty();
});

test('transition: in-app navigations swap inside a view transition, typed by direction; the first render is not animated', async ({ page }) => {
    await serve(page);
    // Record each view transition: its types, and whether the new page was hydrated when its snapshot was taken
    await page.addInitScript(() => {
        const w = window as any;
        w.started = [];
        const start = document.startViewTransition?.bind(document);
        if (!start) return;
        (document as any).startViewTransition = (arg: any) => {
            const t = start(arg);
            const record: any = { types: typeof arg === 'function' ? document.documentElement.dataset.transitionTypes?.split(' ') : arg.types };
            w.started.push(record);
            t.updateCallbackDone.then(() => { record.hydrated = document.querySelector('main')!.dataset.hydrated ?? null; });
            return t;
        };
    });
    await page.goto(`${ORIGIN}/app/?transition`);
    await expect(page.locator('main li')).toHaveCount(2);
    test.skip(!(await hasNavigation(page)) || !(await page.evaluate(() => 'startViewTransition' in document)), 'needs the Navigation API and view transitions');
    const started = () => page.evaluate(() => (window as any).started);
    expect(await started()).toEqual([]);

    await page.locator('main a', { hasText: 'Bag' }).click();
    await expect(page.locator('main h2')).toHaveText('Bag');
    await expect.poll(started).toEqual([{ types: ['forward'], hydrated: '{"id":"1"}' }]);

    await page.goBack();
    await expect(page.locator('main li')).toHaveCount(2);
    await expect.poll(started).toHaveLength(2);
    expect((await started())[1].types).toEqual(['back']);

    // The function decides: more types, or none
    await page.evaluate(() => { (window as any).wanted = ['detail']; });
    await page.locator('main a', { hasText: 'Hat' }).click();
    await expect(page.locator('main h2')).toHaveText('Hat');
    await expect.poll(started).toHaveLength(3);
    expect((await started())[2].types).toEqual(['forward', 'detail']);
    await page.evaluate(() => { (window as any).wanted = false; });
    await page.locator('main a', { hasText: 'All' }).click();
    await expect(page.locator('main li')).toHaveCount(2);
    expect(await started()).toHaveLength(3);
    expect(await page.evaluate(() => (window as any).transitions)).toEqual([
        { from: '/', to: '/products/1', direction: 'forward' },
        { from: '/products/1', to: '/', direction: 'back' },
        { from: '/', to: '/products/2', direction: 'forward' },
        { from: '/products/2', to: '/', direction: 'forward' },
    ]);

    // refresh() isn't animated
    await page.evaluate(() => (window as any).store.refresh());
    await expect.poll(() => renders(page)).toBe(6);
    expect(await started()).toHaveLength(3);
});

test('transition: a newer navigation skips the running transition, and the newer page wins', async ({ page }) => {
    await serve(page);
    await page.goto(`${ORIGIN}/app/?transition`);
    await expect(page.locator('main li')).toHaveCount(2);
    test.skip(!(await hasNavigation(page)) || !(await page.evaluate(() => 'startViewTransition' in document)), 'needs the Navigation API and view transitions');
    // Two navigations, back to back
    await page.evaluate(() => {
        const nav = (window as any).navigation;
        nav.navigate('products/1');
        nav.navigate('products/2');
    });
    await expect(page.locator('main h2')).toHaveText('Hat');
    expect(page.url()).toBe(`${ORIGIN}/app/products/2`);
    await expect(page).toHaveTitle('Hat');
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.transitionTypes ?? null)).toBeNull();
});
