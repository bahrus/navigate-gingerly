# navigate-gingerly

## Introduction

Careful performance measures show that HTML is the fastest format for a web page to display content.  It is the native format the browser knows how to render right away. The ability to display the content as it streams in is something the Web achieved way back in 1994 and was instrumental to the web's success. With the advent of new api's designed to stream HTML *fragments* into *portions* of a web page via [declarative](https://developer.chrome.com/docs/web-platform/declarative-partial-updates) [partial](https://github.com/whatwg/html/issues/13195) [updates](https://github.com/WICG/declarative-partial-updates/blob/main/fragment-include-explainer.md), looking at ways we can architect applications to make use of these new techniques is of paramount importance.  Particularly if the desire is to optimize the end user's experience on low-end mobile phones out in the field with spotty connections.

The biggest roadblock is that in today's environment, backend API's that provide HTML output is quite rare.  JSON response is now the norm.  Rewriting or enhancing these API's to provide HTML could be costly to maintain if each such write is done "manually".

So o2h-edge is a solution to this problem -- it tries to reduce the cost by providing a predictable, easy, reusable, declarative pattern for transforming JSON API's into HTML API's with as much flexibility as possible, while adhering to data-driven configuration.  It includes a strategy for hydrating back into objects in the web browser, that benefits from adopting a common declarative approach uniformly to all APIs.

Suppose the JSON API, at its core, follows a RESTful paradigm.  Using o2h-edge essentially ensures that the same RESTful routing will flow through, as it is just a pass-through combined with a significant data format transformation.

The final piece to the routing puzzle is how the backend api routing relates to front end routing.

Most applications (I'm guessing) don't make much of an effort, if any, to try to align the end user routing browser url paths to the the back end api's.  But with the API's providing HTML output instead of JSON, I think the benefits of at least trying when possible to get this alignment would tend to make more sense.

Undoubtedly, following such an approach could result in a rapid prototype of an application, where it is viewed as basically a wrapper around (a subset of the) backend-api's.

This package provides some utilities to help maintain this alignment.

## The app format (so far)

An app is JSON: an `api`, optional `layout` sources (fetched for every route), and routes. A route's pattern is a
path below the app's base, with literal segments and `:name` parameters (a subset of URLPattern's pathname syntax).
The first route that matches wins.

```json
{
    "api": "https://fakestoreapi.com",
    "layout": { "categories": "/products/categories" },
    "routes": [
        { "pattern": "/", "sources": { "data": "/products" }, "config": { "map": { "categories": "…", "data": "…" } }, "title": "Fake Store" },
        { "pattern": "/products/category/:name", "config": { "map": { "categories": "…", "data": "…" } }, "title": "?.route?.name" },
        { "pattern": "/products/:id", "config": { "map": { "data": "…" } }, "title": "?.data?.title" }
    ],
    "options": {
        "pipes": {
            "usd": { "intl": "NumberFormat", "locale": "en-US", "options": { "style": "currency", "currency": "USD" } },
            "plainText": { "import": "./pipes.js", "export": "plainText" }
        }
    }
}
```

- **Aligned routes** (no `sources`, the default): the path is the API's path. `/products/3` fetches
  `https://fakestoreapi.com/products/3`, as the source named `data`. A path can't climb out of the `api` (`..`).
- **`query`** (aligned routes): the query parameters passed from the page's URL to the API's, **by the same names**, so
  the page's URL keeps the API's structure. With `query: ['startyear', 'endyear']`,
  `/timeseries/data/X?startyear=2015&endyear=2020` fetches `<api>/timeseries/data/X?startyear=2015&endyear=2020`.
  Only those names pass (any other parameter is dropped), the first value of each, and only when not empty, so a
  plain GET form whose fields are named after them works, blank fields included. They're in the VM's `route` too
  (`?.route?.startyear`), so the form can show them. Without `query`, a visitor's query string isn't passed on.
- **Mapped routes** (`sources`): for pages the path alone can't name. Source URLs are relative to the `api` (or
  absolute), with `{name}` placeholders filled from the path's parameters, URI-encoded.
- **The VM a route renders** is `{ route, ...sources }`: `route` holds the path's parameters (`{ id: '3' }`) and its `query` ones, and
  each source its JSON. `config` is a builtIns.tree config for that VM.
- **`title`** is literal text, or a path into the VM.
- **Code** (function pipes, managers) is a module reference, `{ "import": "./pipes.js", "export": "plainText" }`,
  resolved relative to the app's URL.
- **Data pipes aren't code:** in `options.pipes`, a descriptor such as `{ "sum": "?.quantity" }` is plain JSON, so it
  needs no module reference, and the app never calls `dataPipes`. This package only passes `options` along: see
  o2h's [Data pipes survive](https://github.com/bahrus/o2h#data-pipes-survive).

## The modules (so far)

The core is pure (no DOM, no fetch, no o2h), so the page and the worker share it:

| Module | Exports |
|---|---|
| `routes.js` | `matchRoute(app, path)`, `queryOf(route, path)`, `searchOf(match)`, `sourcesFor(app, match)`, `composeVM(match, results)`, `titleFor(route, vm)`, `pathBelow(base, pathname)`, `workerURL(worker, key, path)` |
| `app.js` | `validateApp(app)`, `prepareApp(app, prepareTransform)` (o2h's `prepareO2HTransform` fits), `appKey(installed)` |
| `modules.js` | `resolveModules(app, appURL)`, `isModuleReference(value)` |
| `mirror.js` | `mirror(options)`, `markCurrent(container, href)`: the page side (below) |

```js
import app from './app.json' with { type: 'json' };
import { resolveModules } from 'navigate-gingerly/modules.js';
import { prepareApp } from 'navigate-gingerly/app.js';
import { prepareO2HTransform } from 'o2h/worker/client.js';

const resolved = await resolveModules(app, new URL('./app.json', import.meta.url));
const { key, app: installed } = await prepareApp(resolved, prepareO2HTransform);   // key: app-<32 hex digits>
```

## mirror: the page side

The app's own server serves its shell for every path under the app (an SPA fallback). The shell names the app's base, and calls `mirror`:

```html
<base href="/store/">
<main></main>
<script type="module">
    import { mirror } from 'navigate-gingerly/mirror.js';
    import { o2hRenderer } from 'o2h/worker/edge.js';
    import { app } from './app.js';

    mirror({ worker: 'https://o2h-edge.<your-subdomain>.workers.dev', app, into: document.querySelector('main'), renderer: o2hRenderer() });
</script>
```

- **The path below the base is mirrored to the worker:** `/store/products/3` → `<worker>/o2h-app/<key>/products/3`. The worker ([o2h-edge](https://github.com/bahrus/o2h-edge)) fetches the route's sources and returns one HTML fragment, with the VM embedded. mirror puts it in `into`, and the renderer hydrates it.
- **Installs the app** (`prepareApp`, then `PUT <worker>/o2h-app/<key>`) once per worker, and again, once, if the worker answers `no app`.
- **In-app navigations** (same origin, under the base) are intercepted with the Navigation API, so Back, Forward, scroll and focus are the browser's. Without the Navigation API, links are ordinary navigations, and the shell renders the new path. Of the page's query string, only the route's `query` parameters go to the worker; GET forms are intercepted like links.
- **Links in the app's trees are relative** (`href="products/3"`), resolving against the `<base href>`, so an app works under any base.
- **After each render:** the title comes from the route, and links in the container to the current page get `aria-current="page"`.
- **Falls back:** if the worker passes the VM back, the page renders it. Failures are reported to `onRender`, and the container is left as it was.
- **Transitions (opt in):** with `transition: true`, in-app navigations are animated with a [view transition](https://developer.mozilla.org/docs/Web/API/View_Transition_API). The worker's response is awaited first, with the old page still live. Then the swap and the hydration run inside `document.startViewTransition`, so the new page is captured with its pending parts finished. A newer navigation skips the running transition. The first render and `refresh()` aren't animated, nor are reloads, and browsers without view transitions just swap.
  - **The direction is the transition's type:** `back` for a traverse to an earlier entry, `forward` otherwise. CSS can tell them apart with `:active-view-transition-type(back)`. Where transition types aren't supported, they're on `<html data-transition-types="…">` while the transition runs.
  - **A function decides per navigation:** `transition: ({ from, to, direction }) => …` returns `false` (no transition), `true`, or more types, e.g. `['detail']`.
  - **The animation is the page's CSS:** `::view-transition-old(root)` and friends, and `view-transition-name` on what should morph between pages. It can be set in the app's trees as data, e.g. `style="view-transition-name: product-${'?.id'}"`. Turn it down under `prefers-reduced-motion`.
- **Options:** `worker` (a URL, or a function read on each navigation), `app`, `into`, `renderer` (o2h's `o2hRenderer()`), `appURL` (for relative module references; default: the document's base URL), `base` (default: the `<base href>`'s path), `onRender({ path, by, vm, route, elapsed, pending, error })`, `transition` (above). It returns `{ ready, refresh(), stop() }`.
- **Needs a secure context** (https, or localhost): the app's key is a SHA-256, from `crypto.subtle`.

The [store demo](https://github.com/bahrus/o2h-edge/tree/baseline/demo/store) in o2h-edge uses it.
