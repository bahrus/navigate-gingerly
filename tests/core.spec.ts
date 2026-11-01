import { test, expect } from '@playwright/test';
import fs from 'node:fs';

// The compiled modules, imported straight into Node (no DOM), as a worker would
const url = (path: string) => new URL(`../${path}`, import.meta.url).href;
const storeURL = url('tests/data/store.json');
const store = () => JSON.parse(fs.readFileSync(new URL(storeURL), 'utf8'));

/** A stand-in for o2h's prepareO2HTransform: code becomes `{ $lost: name }`, keyed by content. */
async function prepare(config: unknown, options: unknown) {
  const lost: string[] = [];
  const transform = JSON.parse(JSON.stringify({ config, options }, (key, value) => {
    if (typeof value !== 'function') return value;
    lost.push(key);
    return { $lost: value.name || key };
  }));
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(transform)));
  const hex = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
  return { key: `o2h-${hex.slice(0, 32)}`, transform, lost };
}

test.describe('routes', () => {
  test('matches literal segments and :name parameters, decoded, first route first', async () => {
    const { matchRoute, matchPattern } = await import(url('routes.js'));
    const app = store();
    expect(matchRoute(app, '/products/3')).toMatchObject({ index: 4, params: { id: '3' } });
    expect(matchRoute(app, '/products/categories')).toMatchObject({ index: 2, params: {} });
    expect(matchRoute(app, "/products/category/men's%20clothing")).toMatchObject({ index: 3, params: { name: "men's clothing" } });
    expect(matchRoute(app, '/')).toMatchObject({ index: 0 });
    expect(matchRoute(app, '/products/')).toMatchObject({ index: 1 });   // a trailing slash doesn't matter
    expect(matchRoute(app, '/products/3?x=1')).toMatchObject({ index: 4, params: { id: '3' } });
    expect(matchRoute(app, '/carts/3')).toBeUndefined();
    expect(matchRoute(app, '/products/3/reviews')).toBeUndefined();
    // Malformed %-encoding, and dot segments, don't match
    expect(matchPattern('/products/:id', '/products/%E0%A4%A')).toBeUndefined();
    expect(matchPattern('/products/:id', '/products/%2e%2e')).toBeUndefined();
    expect(() => matchPattern('products', '/products')).toThrow('must start with "/"');
    expect(() => matchPattern('/products/:id?', '/products')).toThrow("isn't a parameter name");
    expect(() => matchPattern('/files/*', '/files/a')).toThrow('not supported here');
  });

  test('sources: layout, then aligned (the path under api, as data) or mapped (placeholders filled)', async () => {
    const { matchRoute, sourcesFor } = await import(url('routes.js'));
    const app = store();
    const sources = (path: string) => sourcesFor(app, matchRoute(app, path));
    expect(sources('/products/3')).toEqual({
      categories: 'https://fakestoreapi.com/products/categories',
      data: 'https://fakestoreapi.com/products/3',
    });
    expect(sources('/')).toEqual({
      categories: 'https://fakestoreapi.com/products/categories',
      data: 'https://fakestoreapi.com/products',
    });
    // layout: false
    expect(sources('/products/categories')).toEqual({ data: 'https://fakestoreapi.com/products/categories' });
    // Aligned: the path as given (still encoded); a visitor's query string doesn't reach the API
    expect(sources("/products/category/men's%20clothing?api_key=x").data).toBe("https://fakestoreapi.com/products/category/men's%20clothing");

    // Mapped, with a placeholder, under an api with a path of its own
    const mapped = {
      api: 'https://api.example.com/v2',
      routes: [{ pattern: '/people/:name', sources: { person: '/people?name={name}&full=1', avatar: 'https://cdn.example.com/a/{name}.png' } }],
    };
    expect(sourcesFor(mapped, matchRoute(mapped, '/people/Jo%20Ann'))).toEqual({
      person: 'https://api.example.com/v2/people?name=Jo%20Ann&full=1',
      avatar: 'https://cdn.example.com/a/Jo%20Ann.png',
    });
    // A slash in a parameter stays encoded: it can't add a segment
    expect(sourcesFor(mapped, matchRoute(mapped, '/people/a%2Fb')).person).toBe('https://api.example.com/v2/people?name=a%2Fb&full=1');
  });

  test("an aligned path can't climb out of the api", async () => {
    const { sourcesFor } = await import(url('routes.js'));
    const app = { api: 'https://api.example.com/v2', routes: [{ pattern: '/a/:x/:y' }] };
    const match = (path: string) => ({ route: app.routes[0], index: 0, params: {}, path });
    expect(sourcesFor(app, match('/a/b/c')).data).toBe('https://api.example.com/v2/a/b/c');
    expect(() => sourcesFor(app, match('/a/../../v1/admin'))).toThrow("leaves the app's api");
    expect(() => sourcesFor(app, match('/a/%2e%2e/%2e%2e/v1'))).toThrow("leaves the app's api");
    // A host-like first segment is just a segment, under the api
    expect(sourcesFor(app, match('//evil.example.com/x')).data).toBe('https://api.example.com/v2/evil.example.com/x');
  });

  test('the VM, the title, the path below the base, and the worker URL', async () => {
    const { matchRoute, composeVM, titleFor, pathBelow, workerURL } = await import(url('routes.js'));
    const app = store();
    const match = matchRoute(app, '/products/3');
    const vm = composeVM(match, { categories: ['a'], data: { title: 'Bag' } });
    expect(vm).toEqual({ categories: ['a'], data: { title: 'Bag' }, route: { id: '3' } });
    expect(titleFor(match.route, vm)).toBe('Bag');
    expect(titleFor(app.routes[0], vm)).toBe('Fake Store');
    expect(titleFor(app.routes[2], vm)).toBeUndefined();
    expect(titleFor({ pattern: '/', title: '?.data?.missing?.deeper' }, vm)).toBeUndefined();

    expect(pathBelow('/store/', '/store/products/3')).toBe('/products/3');
    expect(pathBelow('/store/', '/store/')).toBe('/');
    expect(pathBelow('/store/', '/store')).toBe('/');
    expect(pathBelow('/store', '/storefront')).toBeUndefined();
    expect(pathBelow('/', '/products')).toBe('/products');
    expect(pathBelow('/o2h-edge/demo/store/', '/other/')).toBeUndefined();
    // A trailing index.html names its directory
    expect(pathBelow('/store/', '/store/index.html')).toBe('/');
    expect(pathBelow('/store/', '/store/products/index.html')).toBe('/products/');
    expect(pathBelow('/store/', '/store/products/index.htm')).toBe('/products/index.htm');
    expect(workerURL('http://localhost:8787/', 'app-1', '/products/3')).toBe('http://localhost:8787/o2h-app/app-1/products/3');
  });
});

test.describe('apps', () => {
  test('validateApp names what is wrong', async () => {
    const { validateApp } = await import(url('app.js'));
    expect(() => validateApp(store())).not.toThrow();
    expect(() => validateApp({})).toThrow('needs a routes array');
    expect(() => validateApp({ routes: [{ pattern: '/a' }] })).toThrow('is aligned (no sources), so the app needs an api');
    expect(() => validateApp({ routes: [{ pattern: '/a', sources: { a: '/a' } }] })).toThrow('must be absolute');
    expect(() => validateApp({ routes: [{ pattern: '/a', sources: { a: 'file:///etc/passwd' } }] })).toThrow("isn't http(s)");
    expect(() => validateApp({ api: 'ftp://x', routes: [] })).toThrow("isn't http(s)");
    expect(() => validateApp({ api: 'https://x.com/?key=1', routes: [] })).toThrow("can't have a query");
    expect(() => validateApp({ api: 'https://x.com', routes: [{ pattern: '/p/:id', sources: { p: '/p/{pid}' } }] })).toThrow("isn't one of its parameters (id)");
    expect(() => validateApp({ api: 'https://x.com', layout: { nav: '/nav/{id}' }, routes: [] })).toThrow('has no parameter to fill it');
    expect(() => validateApp({ api: 'https://x.com', routes: [{ pattern: '/', sources: { route: '/r' } }] })).toThrow("can't name a source");
  });

  test('resolveModules loads module references, relative to the app', async () => {
    const { resolveModules, isModuleReference } = await import(url('modules.js'));
    const app = store();
    app.options.managers = { 'x-shout': { import: './pipes.js' } };
    const resolved = await resolveModules(app, storeURL);
    expect(resolved.options.pipes.plainText('<b>Hi</b>')).toBe('Hi');
    expect(resolved.options.managers['x-shout']('hi')).toBe('HI');   // the default export
    expect(resolved.options.pipes.usd).toEqual(app.options.pipes.usd);   // data stays data
    expect(typeof app.options.pipes.plainText).toBe('object');   // the app isn't changed
    expect(isModuleReference({ import: './a.js', export: 'b', extra: 1 })).toBe(false);
    await expect(resolveModules({ routes: [], options: { pipes: { x: { import: './pipes.js', export: 'nope' } } } }, storeURL))
      .rejects.toThrow('options.pipes.x: "./pipes.js" has no export "nope"');
  });

  test('prepareApp: one transform per config, keyed by content', async () => {
    const { prepareApp } = await import(url('app.js'));
    const { resolveModules } = await import(url('modules.js'));
    const app = await resolveModules(store(), storeURL);
    const prepared = await prepareApp(app, prepare);
    expect(prepared.key).toMatch(/^app-[0-9a-f]{32}$/);
    const { routes, transforms, api, layout } = prepared.app;
    expect({ api, layout }).toEqual({ api: app.api, layout: app.layout });
    // grid (routes 0, 1 and 3, equal configs), nav, article
    expect(Object.keys(transforms)).toHaveLength(3);
    expect(new Set([routes[0].transform, routes[1].transform, routes[3].transform]).size).toBe(1);
    expect(routes[2]).toEqual({ pattern: '/products/categories', layout: false, transform: routes[2].transform });
    expect(routes[4]).toEqual({ pattern: '/products/:id', title: '?.data?.title', transform: routes[4].transform });
    expect(prepared.lost[0]).toEqual(['plainText']);
    // Code is stand-ins; the result is plain JSON
    expect(transforms[routes[4].transform].options.pipes.plainText).toEqual({ $lost: 'plainText' });
    expect(JSON.parse(JSON.stringify(prepared.app))).toEqual(prepared.app);

    // The same app, the same key; a changed one, a new key
    expect((await prepareApp(app, prepare)).key).toBe(prepared.key);
    const changed = { ...app, routes: app.routes.map((r: any, i: number) => (i === 4 ? { ...r, title: 'Product' } : r)) };
    expect((await prepareApp(changed, prepare)).key).not.toBe(prepared.key);
  });

  test("a worker can re-check an installed app's key and shape", async () => {
    const { prepareApp, appKey, validateApp } = await import(url('app.js'));
    const { resolveModules } = await import(url('modules.js'));
    const { key, app } = await prepareApp(await resolveModules(store(), storeURL), prepare);
    const received = JSON.parse(JSON.stringify(app));   // as a PUT body arrives
    expect(await appKey(received)).toBe(key);
    expect(() => validateApp(received)).not.toThrow();
  });
});
