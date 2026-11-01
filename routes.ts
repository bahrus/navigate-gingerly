/**
 * The pure core of navigate-gingerly, shared by the page and the worker: no DOM, no fetch.
 *
 * A path (below the app's base) is matched to a route, which says what to fetch and how the result renders:
 *
 *     const match = matchRoute(app, '/products/3');              // { route, index, params: { id: '3' }, path }
 *     const urls = sourcesFor(app, match);                       // { categories: '…/products/categories', data: '…/products/3' }
 *     const vm = composeVM(match, { categories: [...], data: {...} });   // { route: { id: '3' }, categories, data }
 *     document.title = titleFor(match.route, vm) ?? document.title;
 *
 * Aligned routes (no `sources`) fetch the path itself under the app's `api`, as the source `data`. Mapped routes
 * name their sources, with `{name}` placeholders filled from the path's parameters, URI-encoded.
 */

import type { AppLike, RouteLike, RouteMatch } from './types/navigate-gingerly/types.js';

// For consumers (the package's exports don't reach into types/)
export type {
    AppLike, AppRoute, InstalledApp, InstalledRoute, ModuleReference, NavigateApp, PreparedApp, PreparedTransform,
    PrepareTransform, RouteLike, RouteMatch, Mirror, MirrorOptions, MirrorRenderer, MirrorRendered,
} from './types/navigate-gingerly/types.js';

/** The source name an aligned route's API response gets in the VM. */
export const ALIGNED_SOURCE = 'data';

/** The VM key holding the path's parameters. */
export const ROUTE_KEY = 'route';

/** A pattern's segments: literals, or `{ param }`. */
type Segment = string | { param: string };

const PARAM = /^:([A-Za-z_][\w]*)$/;
/** A `{name}` placeholder in a source URL. */
export const PLACEHOLDER = /\{([A-Za-z_][\w]*)\}/g;
const parsed = new Map<string, Segment[]>();

/** A pattern's segments (cached). Throws for a malformed pattern. */
function segmentsOf(pattern: string): Segment[] {
    let segments = parsed.get(pattern);
    if (segments) return segments;
    if (!pattern.startsWith('/')) throw new Error(`navigate-gingerly: the pattern "${pattern}" must start with "/"`);
    segments = pattern.split('/').filter(s => s !== '').map(s => {
        if (s.startsWith(':')) {
            const [, param] = s.match(PARAM) ?? [];
            if (!param) throw new Error(`navigate-gingerly: "${s}" in the pattern "${pattern}" isn't a parameter name`);
            return { param };
        }
        if (/[*?+(){}]/.test(s)) throw new Error(`navigate-gingerly: "${s}" in the pattern "${pattern}" uses URLPattern syntax not supported here (only literals and :name)`);
        return s;
    });
    parsed.set(pattern, segments);
    return segments;
}

/** The parameter names a pattern declares. */
export function paramsOf(pattern: string): string[] {
    return segmentsOf(pattern).flatMap(s => (typeof s === 'string' ? [] : [s.param]));
}

/** The path's parameters if it matches the pattern; undefined otherwise. */
export function matchPattern(pattern: string, path: string): Record<string, string> | undefined {
    const segments = segmentsOf(pattern);
    const parts = path.split(/[?#]/)[0].split('/').filter(s => s !== '');
    if (parts.length !== segments.length) return undefined;
    const params: Record<string, string> = {};
    for (let i = 0; i < parts.length; i++) {
        let part: string;
        try {
            part = decodeURIComponent(parts[i]);
        } catch {
            return undefined;   // malformed %-encoding
        }
        const segment = segments[i];
        if (typeof segment === 'string') {
            if (part !== segment) return undefined;
        } else {
            // "." and ".." would move a filled-in source URL up its path
            if (part === '.' || part === '..') return undefined;
            params[segment.param] = part;
        }
    }
    return params;
}

/** The first route the path (below the app's base) matches, with its parameters. */
export function matchRoute<Route extends RouteLike>(app: AppLike<Route>, path: string): RouteMatch<Route> | undefined {
    const { routes } = app;
    for (let index = 0; index < routes.length; index++) {
        const route = routes[index];
        const params = matchPattern(route.pattern, path);
        if (params) return { route, index, params, path };
    }
    return undefined;
}

/**
 * The URLs a match fetches, by source name: the app's layout sources (unless the route opts out), then the
 * route's own (aligned: the path under `api`, as `data`; mapped: its sources, placeholders filled).
 * Throws if a URL would leave the app's API (an aligned path) or isn't http(s).
 */
export function sourcesFor(app: AppLike, match: RouteMatch): Record<string, string> {
    const { api, layout } = app;
    const { route, params, path } = match;
    const urls: Record<string, string> = {};
    if (layout && route.layout !== false) {
        for (const [name, url] of Object.entries(layout)) urls[name] = resolve(api, url);
    }
    if (route.sources) {
        for (const [name, url] of Object.entries(route.sources)) urls[name] = resolve(api, fill(url, params));
    } else {
        urls[ALIGNED_SOURCE] = aligned(api, path);
    }
    return urls;
}

/** `{name}` placeholders, filled from the parameters, URI-encoded. */
export function fill(url: string, params: Record<string, string>): string {
    return url.replace(PLACEHOLDER, (_, name) => {
        if (!Object.hasOwn(params, name)) throw new Error(`navigate-gingerly: "{${name}}" in "${url}" isn't a parameter of the route`);
        const value = params[name];
        if (value === '.' || value === '..') throw new Error(`navigate-gingerly: "{${name}}" can't be "${value}"`);
        return encodeURIComponent(value);
    });
}

/** A source URL: absolute, or a path appended to the API's (so `/products` under `https://x.com/v2` is `https://x.com/v2/products`). */
function resolve(api: string | undefined, url: string): string {
    if (ABSOLUTE.test(url)) {
        let resolved: URL;
        try {
            resolved = new URL(url);
        } catch {
            throw new Error(`navigate-gingerly: the source "${url}" isn't a URL`);
        }
        if (resolved.protocol !== 'https:' && resolved.protocol !== 'http:') throw new Error(`navigate-gingerly: the source "${url}" isn't http(s)`);
        return resolved.href;
    }
    if (!api) throw new Error(`navigate-gingerly: the source "${url}" must be absolute, since the app has no api`);
    return under(api, url);
}

/** An aligned path, under the API: `https://x.com/v2` and `/products/3` → `https://x.com/v2/products/3`. */
function aligned(api: string | undefined, path: string): string {
    if (!api) throw new Error('navigate-gingerly: an aligned route (no sources) needs the app\'s api');
    // The path only: a visitor's query string doesn't reach the API
    return under(api, path.split(/[?#]/)[0]);
}

/** A path (and query) appended to the API's URL, which it may not climb out of. */
function under(api: string, path: string): string {
    const base = new URL(withSlash(api));
    const url = new URL(base.href + path.replace(/^\/+/, ''));
    // Dot segments ("..", "%2e%2e") could climb out of the API's path
    if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) {
        throw new Error(`navigate-gingerly: "${path}" leaves the app's api`);
    }
    return url.href;
}

const ABSOLUTE = /^[a-z][a-z\d+.-]*:/i;

function withSlash(url: string): string {
    return url.endsWith('/') ? url : `${url}/`;
}

/** The VM a route renders: `{ route: params, ...sources }`. */
export function composeVM(match: RouteMatch, results: Record<string, unknown>): Record<string, unknown> {
    return { ...results, [ROUTE_KEY]: match.params };
}

/** The route's title for a VM: literal text, or a path into it (`?.data?.title`). Undefined if it has none, or the path leads nowhere. */
export function titleFor(route: RouteLike, vm: unknown): string | undefined {
    const { title } = route;
    if (title === undefined || !title.startsWith('?.')) return title;
    let value: any = vm;
    for (const step of title.slice(2).split('?.')) {
        if (step === '') continue;
        if (value == null) return undefined;
        value = value[step];
    }
    return value == null ? undefined : String(value);
}

/**
 * The path below the app's base, or undefined if the pathname isn't under it.
 * `pathBelow('/store/', '/store/products/3')` → `/products/3`; `/store` and `/store/` → `/`.
 * A trailing `index.html` names its directory, as a static server serves it: `/store/index.html` → `/`.
 */
export function pathBelow(base: string, pathname: string): string | undefined {
    const prefix = base.replace(/\/+$/, '');
    if (pathname === prefix) return '/';
    if (!pathname.startsWith(`${prefix}/`)) return undefined;
    const path = pathname.slice(prefix.length);
    return path.endsWith('/index.html') ? path.slice(0, -'index.html'.length) : path;
}

/** Where a worker renders an installed app's path: `<worker>/o2h-app/<key><path>`. */
export function workerURL(worker: string, key: string, path: string): string {
    return `${worker.replace(/\/+$/, '')}/o2h-app/${key}${path.startsWith('/') ? path : `/${path}`}`;
}
