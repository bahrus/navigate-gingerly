/**
 * Apps: checking one, and preparing it to install with a worker.
 *
 * prepareApp turns each route's config (with the app's options) into a transform, through the function it's
 * given (o2h's prepareO2HTransform, typically, so this package needn't depend on o2h), and keys the result by a
 * hash of its content, as transforms are keyed: the same app gets the same key, a changed one a new key.
 *
 *     import { prepareO2HTransform } from 'o2h/worker/client.js';
 *     const { key, app: installed } = await prepareApp(await resolveModules(app, appURL), prepareO2HTransform);
 *     await fetch(`${worker}/o2h-app/${key}`, { method: 'PUT', body: JSON.stringify(installed) });
 *
 * Code in the app's options must be real code by then (resolveModules), so the transform can replace it with
 * stand-ins: a worker never runs it.
 */
import { paramsOf, PLACEHOLDER, ROUTE_KEY } from './routes.js';
/**
 * Throws, naming the problem, if the app (authored or installed) isn't well formed: patterns, placeholders
 * that aren't parameters of their route, layout placeholders, a source named `route`, relative sources with no
 * `api`. A worker checks installed apps with this too, since anyone may install one.
 */
export function validateApp(app) {
    if (!app || typeof app !== 'object' || !Array.isArray(app.routes))
        throw new Error('navigate-gingerly: an app needs a routes array');
    const { api, layout, routes } = app;
    if (api !== undefined) {
        let url;
        try {
            url = new URL(api);
        }
        catch {
            throw new Error(`navigate-gingerly: the api "${api}" isn't a URL`);
        }
        if (url.protocol !== 'https:' && url.protocol !== 'http:')
            throw new Error(`navigate-gingerly: the api "${api}" isn't http(s)`);
        if (url.search || url.hash)
            throw new Error(`navigate-gingerly: the api "${api}" can't have a query or hash (paths are appended to it)`);
    }
    if (layout !== undefined)
        checkSources(layout, [], 'the layout', api);
    routes.forEach((route, i) => {
        const where = `route ${i} ("${route?.pattern}")`;
        if (!route || typeof route.pattern !== 'string')
            throw new Error(`navigate-gingerly: route ${i} needs a pattern`);
        const params = paramsOf(route.pattern);
        if (route.sources !== undefined)
            checkSources(route.sources, params, where, api);
        else if (!api)
            throw new Error(`navigate-gingerly: ${where} is aligned (no sources), so the app needs an api`);
        if (route.title !== undefined && typeof route.title !== 'string')
            throw new Error(`navigate-gingerly: ${where}: the title must be a string`);
    });
}
function checkSources(sources, params, where, api) {
    if (!sources || typeof sources !== 'object' || Array.isArray(sources))
        throw new Error(`navigate-gingerly: ${where}: sources must be an object of URLs`);
    for (const [name, url] of Object.entries(sources)) {
        if (name === ROUTE_KEY)
            throw new Error(`navigate-gingerly: ${where}: "${ROUTE_KEY}" is the VM's key for the path's parameters, so it can't name a source`);
        if (typeof url !== 'string')
            throw new Error(`navigate-gingerly: ${where}: the source "${name}" must be a URL`);
        for (const [, param] of url.matchAll(PLACEHOLDER)) {
            if (!params.includes(param)) {
                throw new Error(`navigate-gingerly: ${where}: "{${param}}" in the source "${name}" ${params.length ? `isn't one of its parameters (${params.join(', ')})` : 'has no parameter to fill it'}`);
            }
        }
        if (/^[a-z][a-z\d+.-]*:/i.test(url)) {
            if (!/^https?:\/\//i.test(url))
                throw new Error(`navigate-gingerly: ${where}: the source "${name}" isn't http(s)`);
        }
        else if (!api) {
            throw new Error(`navigate-gingerly: ${where}: the source "${name}" must be absolute, since the app has no api`);
        }
    }
}
/** Prepare an app to install (see the module comment). */
export async function prepareApp(app, prepare) {
    validateApp(app);
    const { api, layout, routes, options } = app;
    const transforms = {};
    const lost = {};
    // Routes sharing a config share its transform (prepared once)
    const byConfig = new Map();
    const installedRoutes = [];
    for (let i = 0; i < routes.length; i++) {
        const { pattern, sources, layout: withLayout, title, config } = routes[i];
        let pending = byConfig.get(config);
        if (!pending)
            byConfig.set(config, (pending = prepare(config, options)));
        const { key, transform, lost: routeLost } = await pending;
        transforms[key] = transform;
        if (routeLost?.length)
            lost[i] = routeLost;
        // Only what was given, in a fixed order, so the key depends on content alone
        installedRoutes.push({
            pattern,
            ...(sources !== undefined && { sources }),
            ...(withLayout !== undefined && { layout: withLayout }),
            ...(title !== undefined && { title }),
            transform: key,
        });
    }
    const installed = {
        ...(api !== undefined && { api }),
        ...(layout !== undefined && { layout }),
        routes: installedRoutes,
        transforms,
    };
    return { key: await appKey(installed), app: installed, lost };
}
/** `app-` and 32 hex digits of the app's SHA-256. */
export async function appKey(app) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(app)));
    const hex = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
    return `app-${hex.slice(0, 32)}`;
}
