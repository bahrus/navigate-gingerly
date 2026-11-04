/**
 * mirror: the page side. The app's own server serves its shell (an SPA fallback for deep paths); mirror asks the
 * worker for the same path, mirrored (`<worker>/o2h-app/<key><path below the base>`), puts the fragment it gets
 * into a container, and hydrates it. In-app navigations are intercepted with the Navigation API and rendered the
 * same way, so Back, Forward, scroll and focus are the browser's. Of the page's query string, only the parameters
 * the route lets through (`query`) go to the worker, so a plain GET form can ask for them. Without the Navigation API, links are ordinary
 * navigations: the shell loads again, and mirror renders the new path.
 *
 *     <base href="/store/">   (in the shell: the app's base, which relative links in the app's trees resolve against)
 *
 *     import app from './app.json' with { type: 'json' };
 *     import { mirror } from 'navigate-gingerly/mirror.js';
 *     import { o2hRenderer } from 'o2h/worker/edge.js';
 *     mirror({ worker: 'https://o2h-edge.example.workers.dev', app, into: document.querySelector('main'), renderer: o2hRenderer() });
 *
 * The app is installed with the worker once (and again if the worker has lost it). If the worker can't render a
 * route, it passes the VM back and the page renders it. After each render, the title is set from the route, and
 * links in the container to the current page get `aria-current="page"`.
 *
 * With `transition`, in-app navigations are animated with a view transition: the worker's response is awaited first
 * (the old page stays live meanwhile), then the swap and hydration run inside `document.startViewTransition`, so the
 * new snapshot is taken once pending parts are finished. A newer navigation skips the running transition.
 */
import { prepareApp } from './app.js';
import { resolveModules } from './modules.js';
import { matchRoute, pathBelow, searchOf, titleFor, workerURL } from './routes.js';
/** `<worker> <key>`: the apps each worker is known to hold. */
const installed = new Set();
/** Mirror the page's path to the worker, now and on each in-app navigation (see the module comment). */
export function mirror(options) {
    const { app, into, renderer, onRender, transition } = options;
    const base = options.base ?? new URL(document.baseURI).pathname;
    const workerOf = () => (typeof options.worker === 'function' ? options.worker() : options.worker).replace(/\/+$/, '');
    // The app with its code loaded, and prepared to install (once)
    const resolving = resolveModules(app, options.appURL ?? document.baseURI);
    let preparing;
    const prepared = () => (preparing ??= resolving.then(resolved => prepareApp(resolved, renderer.prepare)));
    async function install(worker, { key, app: body }) {
        const response = await fetch(`${worker}/o2h-app/${key}`, { method: 'PUT', body: JSON.stringify(body) });
        if (!response.ok)
            throw new Error(`installing the app: ${await errorOf(response)}`);
        installed.add(`${worker} ${key}`);
    }
    /** The path rendered last, and the transition running (if any) */
    let current;
    let active;
    /** The transition's types for a navigation, or undefined for none */
    function typesFor(navigation) {
        const wanted = typeof transition === 'function' ? transition(navigation) : transition;
        if (!wanted)
            return undefined;
        return [navigation.direction, ...(Array.isArray(wanted) ? wanted : [])];
    }
    /** Change the container: within a view transition when there are types and the browser has them */
    async function swap(change, types) {
        if (!types || typeof document.startViewTransition !== 'function')
            return change();
        active?.skipTransition();
        const root = document.documentElement;
        let started;
        try {
            started = document.startViewTransition({ update: change, types });
        }
        catch {
            // Without transition types (an older engine): the types as an attribute instead, while it runs
            root.dataset.transitionTypes = types.join(' ');
            started = document.startViewTransition(change);
        }
        active = started;
        started.ready.catch(() => { }); // skipped by a newer navigation
        started.finished.catch(() => { }).finally(() => {
            if (active !== started)
                return;
            active = undefined;
            delete root.dataset.transitionTypes;
        });
        await started.updateCallbackDone;
    }
    async function show(url, signal, direction) {
        const below = pathBelow(base, url.pathname) ?? '/';
        // Reported as the path below the base, with the query parameters the route lets through (once matched)
        let path = below;
        const started = performance.now();
        const done = (rendered) => {
            const result = { path, elapsed: Math.round(performance.now() - started), ...rendered };
            onRender?.(result);
            return result;
        };
        try {
            const resolved = await resolving;
            const match = matchRoute(resolved, below + url.search);
            if (!match)
                return done({ by: 'none', pending: 0, error: `no route of the app matches "${path}"` });
            const { route, index } = match;
            path = below + searchOf(match);
            const worker = workerOf();
            const app = await prepared();
            const request = async () => {
                if (!installed.has(`${worker} ${app.key}`))
                    await install(worker, app);
                return fetch(workerURL(worker, app.key, path), { signal });
            };
            let response = await request();
            // The worker lost the app (e.g. a restarted `wrangler dev`): install it again, once
            if (response.status === 404 && (await errorOf(response.clone())).includes('no app')) {
                installed.delete(`${worker} ${app.key}`);
                response = await request();
            }
            const { config } = route;
            const { options: appOptions } = resolved;
            const types = direction && typesFor({ from: current, to: path, direction });
            if ((response.headers.get('Content-Type') ?? '').startsWith('text/html')) {
                const html = await response.text();
                signal?.throwIfAborted();
                let vm, pending = 0;
                await swap(async () => {
                    into.innerHTML = html;
                    vm = renderer.embedded(into, config);
                    ({ pending = 0 } = (await renderer.hydrate(into, config, vm, appOptions)) ?? {});
                }, types);
                finish(route, vm, path);
                return done({ by: 'worker', vm, route: index, pending });
            }
            if (!response.ok)
                throw new Error(await errorOf(response));
            // The VM, passed back: render it here
            const vm = await response.json();
            signal?.throwIfAborted();
            await swap(async () => { await renderer.render(into, config, vm, appOptions); }, types);
            finish(route, vm, path);
            return done({ by: 'page', vm, route: index, pending: 0, error: response.headers.get('X-O2H-Error') ?? undefined });
        }
        catch (e) {
            if (e.name === 'AbortError')
                throw e; // a newer navigation took over
            return done({ by: 'none', pending: 0, error: e.message });
        }
    }
    /** After a render: the title, and which links are the current page. */
    function finish(route, vm, path) {
        current = path;
        const title = titleFor(route, vm);
        if (title !== undefined)
            document.title = title;
        markCurrent(into, location.href);
    }
    // In-app navigations: same origin, under the base, a route of the app
    const navigation = globalThis.navigation;
    const onNavigate = (event) => {
        if (!event.canIntercept || event.hashChange || event.downloadRequest !== null || event.formData)
            return;
        const url = new URL(event.destination.url);
        if (url.origin !== location.origin)
            return;
        const path = pathBelow(base, url.pathname);
        if (path === undefined)
            return;
        // Back: a traverse to an earlier entry. A reload isn't animated.
        const back = event.navigationType === 'traverse' && event.destination.index < navigation.currentEntry.index;
        const direction = event.navigationType === 'reload' ? undefined : back ? 'back' : 'forward';
        event.intercept({
            handler: () => show(url, event.signal, direction),
            scroll: 'after-transition',
            focusReset: 'after-transition',
        });
    };
    navigation?.addEventListener('navigate', onNavigate);
    return {
        ready: show(new URL(location.href)),
        refresh: () => show(new URL(location.href)),
        stop: () => navigation?.removeEventListener('navigate', onNavigate),
    };
}
/** `aria-current="page"` on the container's links to the page (the hash aside); removed from the others. */
export function markCurrent(container, href) {
    const here = href.split('#')[0];
    for (const a of container.querySelectorAll('a[href]')) {
        if (a.href.split('#')[0] === here)
            a.setAttribute('aria-current', 'page');
        else if (a.getAttribute('aria-current') === 'page')
            a.removeAttribute('aria-current');
    }
}
async function errorOf(response) {
    const { error } = await response.json().catch(() => ({ error: response.statusText }));
    return `${response.status} ${error ?? ''}`.trim();
}
