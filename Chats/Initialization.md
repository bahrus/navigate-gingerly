# Initialization

## Bruce's Ask

I've edited this package's README.md to lay out what in my mind is the goal of this package.  Does that align with where our [Navigations discussion](../../o2h/Chats/Navigations.md) ended up?

Can you lay out carry over the discussion from that chat here, and restate the strategy / questions / clarifications below that are applicable to this package?

## Claude's Thoughts

### Does the README align with where Navigations ended up?

**Yes, and it goes one step further.** The README states the goal more sharply than the chat did.

**Where the chat ended (Thoughts IV, "the mirrored hybrid"):**
- The app's own server (spa-ssi) serves the shell.
- The page mirrors its path to the edge: `/store/product/3` → `<edge>/o2h-app/<hash>/product/3`.
- The edge looks the path up in an **installed app's route table** and returns a rendered fragment.

**What the README adds:** the browser's paths should line up with **the API's own paths**, not only with the edge's. In the chat, a route was an arbitrary pattern mapped to arbitrary sources:

```json
{ "pattern": "/product/:id", "sources": { "product": "https://fakestoreapi.com/products/{id}" } }
```

**With the README's alignment,** the mapping becomes a convention, and the browser path *is* the API path below a base:

| Browser (spa-ssi) | Edge | Upstream API |
|---|---|---|
| `/store/products` | `<edge>/o2h-app/<hash>/products` | `https://fakestoreapi.com/products` |
| `/store/products/3` | `<edge>/o2h-app/<hash>/products/3` | `https://fakestoreapi.com/products/3` |
| `/store/products/category/jewelery` | `<edge>/o2h-app/<hash>/products/category/jewelery` | `https://fakestoreapi.com/products/category/jewelery` |

The edge then only needs the API's **origin** plus a transform per **path shape**, and no source URLs at all. That's the "pass-through plus a format change" the README describes, and it's what makes "a rapid prototype as a wrapper around a subset of the API" plausible: list the shapes you want, give each a transform, done.

**Where pure alignment falls short**, and the route table from the chat is still needed:
1. **Pages built from more than one API call.** The store's category page shows the category nav (`/products/categories`) and the grid (`/products/category/:name`). Only one of them can be "the" path. I'd handle this with **layout sources**: extra sources fetched on every route (or a group of routes), next to the one the path names. The VM stays `{ route, ...sources }` from the chat, with the aligned source under a fixed name.
2. **API paths that aren't nice browser paths:** query-string APIs (`?api_key=…&date=…`, as APOD does), versioned prefixes (`/v2/…`), or paths that collide (`/products/categories` vs `/products/:id`, where order decides). Here an explicit route that maps a browser path to an API URL is still needed.
3. **Secrets in the API URL.** The API key rule stands: keys never go in the worker or in pages. An aligned path must never carry one, so APIs that require a key in the URL stay explicit routes with the key supplied by the visitor, as now.

**So I'd suggest the package supports both, with alignment as the default:**
- **Aligned routes:** `{ "api": "https://fakestoreapi.com", "shapes": { "/products": …, "/products/:id": …, "/products/category/:name": … } }`: the path is passed through, and the shape only picks the transform.
- **Mapped routes:** the chat's `{ pattern, sources }`, for everything else.

That keeps the README's alignment the easy, normal path, with an escape hatch rather than a second design.

**On "new APIs designed to stream HTML into a web page via partial updates":** I take that to mean the WHATWG work on streaming HTML into existing elements and declarative partial updates (processing-instruction markers for out-of-order patches). I'm not certain of their current shipping status, so I'd write `mirror` to insert a fragment with what ships everywhere today, and keep the insertion step one replaceable function, so it can move to a streaming API once one is available. If you have specific APIs in mind, please name them and I'll design around them.

### Carried over from Navigations

**Agreed or settled:**
1. **Two servers, two roles.** o2h-edge is a reusable, "dumb" transformer that obeys what it's given. The app (served by spa-ssi or any server) knows how its routes map to APIs.
2. **The navigation code doesn't belong in o2h.** o2h stays "object to HTML", plus the fetch worker core. This package holds the routing. **This package should not depend on o2h.** It takes a "render this VM with this transform" function. o2h doesn't import it either. The runtimes (the page, the edge, later a service worker) compose the two.
3. **The name:** `navigate-gingerly`.
4. **The Navigation API, not `history.state`.** Its core (`navigate` events, `intercept`, `currentEntry`, `transition`) is enough. Avoid the newest additions (precommit handlers, deferred commit) for now. Without the API, links are ordinary navigations, and the SPA fallback returns the shell, which renders the URL: progressive enhancement with no history code.
5. **A JSON app definition, declarative and side-effect free.** Configs are written in notation. Data pipes are descriptors. Code (function pipes, managers) is a `{ "import": "./pipes.js", "export": "plainText" }` module reference: the page resolves it with dynamic `import()` relative to the JSON's URL, and the edge sees a stand-in it leaves pending. `` tree`…` `` becomes a build-time helper for writing the JSON.
6. **Apps are installed on the edge by content hash** (from Model A): `PUT /o2h-app/<hash>`. The client prepares the app (stand-ins, then the hash), and the edge checks the hash, caps the size, and stores it in KV. Nobody can change an installed app, only install a new one, and `/o2h-app/<hash>/…` namespaces each app.
7. **Model B first, shaped as the mirrored hybrid** (your "Doppelganger"): spa-ssi serves the shell and code, and the edge returns fragments for mirrored paths. Since the edge only returns fragments, the shared-origin concerns of Model A (apps reading each other's storage, anyone hosting pages on the edge's domain) don't arise yet.

**Deferred, but kept in view:**
- **Server-rendered documents (Model A)** for first loads and crawlers: the same mirrored URL, answered with a whole document when it's a direct navigation (`Sec-Fetch-Dest: document`), given a shell. That brings back origin isolation: a CSP limiting scripts to the runtime and declared origins, admin-only installs off the sandbox, and per-app origins (`<hash>.apps.example.com`) once there's a custom domain.
- **Named aliases** (`/o2h-app/@store/…` → the current hash, admin token only), if shared links should pick up fixes.
- **A service worker runtime,** which would reuse the same core within its scope.
- **Streaming,** and caching catalog sources.

### Strategy for this package

**What navigate-gingerly holds:**
1. **The app format** (JSON): aligned and mapped routes, layout sources, per-route titles as paths into the VM, options (data pipes, module references).
2. **`prepareApp(app)`:** module references → stand-ins, then the content hash, as `prepareO2HTransform` does for transforms. It needs o2h's stand-in helper, so either it takes that as a parameter, or this one function lives in o2h. That's question 4 below.
3. **The pure core,** shared by the page and the edge, with no DOM and no fetch:
   - `matchRoute(app, path)`: `URLPattern`, in route order;
   - `sourcesFor(match)`: the aligned API URL, or the mapped sources with `{name}` filled in, URI-encoded;
   - `composeVM(match, results)`: `{ route, ...sources }`.
4. **`mirror({ edge, app, base, into })`**, the page side:
   - installs the app once per edge (re-installing on "no app", as `renderViaEdge` does for transforms);
   - renders the current path on load, then intercepts in-app navigations with the Navigation API (`event.signal` cancels an earlier fetch, with scroll and focus handled by `intercept`);
   - inserts and hydrates the fragment, and sets the title;
   - falls back to rendering on the page when the edge fails, as `renderViaEdge` does.
5. **Not in this package:** the edge endpoints. They go in o2h-edge, importing the pure core from here.

**Suggested order:**
1. The app format and the pure core, with Node tests.
2. The edge endpoints in o2h-edge: install, and the mirrored render returning a fragment.
3. `mirror` in the browser, then the store rewritten on it at `o2h-edge/demo/store/`, with real URLs.
4. Then decide on server-rendered documents.

### Questions

1. **Alignment as the default:** aligned routes (path passed through, the shape picks the transform) as the normal case, plus mapped routes and layout sources for the rest, as above? For the store, that would make its URLs `/store/products/3` and `/store/products/category/jewelery`, matching the API, rather than the `/store/product/3` used in the chat.
2. **The mapping to the edge:** `<edge>/o2h-app/<hash>/<path below the app's base>`, so the same app works at `/store/` or `/o2h-edge/demo/store/`?
3. **The fragment's shape:** one tree for `<main>`, with the nav as a layout source? Or named slots (`nav`, `main`), each with its own tree? One tree is simpler. Slots would let the nav stay put while `<main>` changes.
4. **Where `prepareApp` lives:** it needs o2h's stand-in code. Options:
   - (a) navigate-gingerly takes a `prepare` function as a parameter, so it doesn't depend on o2h (my pick);
   - (b) o2h exports `prepareO2HApp`, which knows this package's format;
   - (c) the stand-in code moves somewhere both can import.
5. **Installs:** open, like transforms, since the edge only returns fragments?
6. **The `eq` data pipe** for `aria-current` (the current category, from `route.name`): add it to assign-gingerly as part of this?
7. **Streaming partial updates:** which APIs did you have in mind in the README's first line, if any specific ones?
8. **Language and build:** `.ts` sources built to `.js`, as in assign-gingerly and o2h, with the same conventions (AGENTS.md, a `types` submodule)? And Playwright for the browser tests, as the package.json already suggests?

## Bruce's Response I

> 1. **Alignment as the default:**

Agreed.

> 2. **The mapping to the edge:**

Sounds good.

> 3. **The fragment's shape:** 

I'd have to see this with examples to decide.  Would it make sense to implement the simpler for now, and would it be easy to transition to the named slots with a strong use case?

4. **Where `prepareApp` lives:** 

Option a sounds good.

> 5. **Installs:** open, like transforms, since the edge only returns fragments?

Sounds good.

> 6. **The `eq` data pipe** for `aria-current` (the current category, from `route.name`): add it to assign-gingerly as part of this?

I'm not sure.  Please do what makes sense to you.

> 7. **Streaming partial updates:** which APIs did you have in mind in the README's first line, if any specific ones?

Let's wait until Chrome releases this into production.  Use traditional approaches for now.

> 8. **Language and build:** `.ts` sources built to `.js`, as in assign-gingerly and o2h, with the same conventions (AGENTS.md, a `types` submodule)? And Playwright for the browser tests, as the package.json already suggests?

Yes, same as assign-gingerly and o2h

## Claude's Thoughts II / Implementation Notes I

### 3. The fragment's shape, with examples

**One tree (what I've built for):** each route has one `config`, rendering the whole VM into one container.

```json
{ "pattern": "/products/category/:name", "config": { "map": { "categories": "<nav tree>", "data": "<grid tree>" } } }
```

```js
mirror({ worker, app, into: document.querySelector('main') });
```

The edge returns `<nav>…</nav><section>…</section>` plus the embedded VM, and `mirror` replaces `<main>`'s content with it. On every navigation, the nav is rendered again (the same data, so it looks unchanged).

**Named slots (later, if needed):** a route renders several containers, each with its own tree.

```json
{ "pattern": "/products/category/:name", "slots": {
    "nav": { "map": { "categories": "<nav tree>" } },
    "main": { "map": { "data": "<grid tree>" } }
} }
```

```js
mirror({ worker, app, into: { nav: document.querySelector('nav'), main: document.querySelector('main') } });
```

The edge would return each slot's HTML separately (say, `<template data-slot="nav">…</template><template data-slot="main">…</template>`), and `mirror` would fill each container.

**What slots would buy:**
- **Parts of the page stay put across navigations:** focus, scroll position, an open menu, a search box being typed in.
- **Skipping work:** the edge could skip a slot whose sources are the same as last time.

**Yes, the simpler one first, and the switch is easy.** Slots can be added without breaking anything: `config` stays as shorthand for `slots: { main: config }`, and `into: element` for `into: { main: element }`. Apps written the simple way keep working, and keep their keys.

### 6. The `eq` pipe: I'd leave it out

- **Data pipes take one value.** "Is this category the current one?" compares two values: the item and `$root?.route?.name`. That needs a new kind of binding, not just a new pipe.
- **dataPipes rules this out on purpose.** Its header says: "No comparisons, arithmetic, filtering or sorting." I'd rather not change that rule just for this.
- **What I'd do instead:** after inserting a fragment, `mirror` sets `aria-current="page"` on the fragment's links that point to the current URL, and removes it from the others. That's a convention navigation libraries commonly follow. It needs no per-app code or config, and it covers every nav, not just the store's. The store's `markCategory()` becomes part of `mirror`.

### What's implemented: step 1, the app format and the core

**Files** (all in this repo; nothing changed in the others):
- **[types/navigate-gingerly/types.d.ts](../types/navigate-gingerly/types.d.ts):** the app format (`NavigateApp`, `AppRoute`, `ModuleReference`), the installed form (`InstalledApp`, `InstalledRoute`), `PrepareTransform`, `PreparedApp`, `RouteMatch`. The `types` folder is a new submodule (`bahrus/types`, branch `baseline`), as in o2h. The new folder is uncommitted in it.
- **[routes.ts](../routes.ts)** (pure):
  - `matchRoute(app, path)` and `matchPattern(pattern, path)`;
  - `sourcesFor(app, match)` and `fill(url, params)`;
  - `composeVM(match, results)` and `titleFor(route, vm)`;
  - `pathBelow(base, pathname)` and `workerURL(worker, key, path)`.
- **[app.ts](../app.ts):**
  - `validateApp(app)`, which the edge will also run on every install, since installs are open;
  - `prepareApp(app, prepareTransform)` (option (a): o2h's `prepareO2HTransform` is passed in);
  - `appKey(installed)`.
- **[modules.ts](../modules.ts):** `resolveModules(app, appURL)` and `isModuleReference(value)`.
- **[tests/core.spec.ts](../tests/core.spec.ts):** 8 Node tests, using a sample store app ([tests/data/store.json](../tests/data/store.json)) and a stand-in for `prepareO2HTransform`. **All 8 pass** (`tsc`, then `npx playwright test`).
- **Setup:**
  - `tsconfig.json` and `playwright.config.ts` (one Node project for now; browser projects come with `mirror`);
  - `package.json`, with exports, files and scripts;
  - `@playwright/test` 1.64.1, as in o2h;
  - `CLAUDE.md` and a short `AGENTS.md` with the same conventions;
  - `.gitignore` entries for Playwright's output.
- **[README.md](../README.md):** I added two sections after your goals: "The app format (so far)" and "The modules (so far)". Your text is unchanged.

**Decisions made along the way** (easy to change):
1. **An aligned route's source is named `data`,** so the VM is `{ route, data, ...layout }`.
2. **Route patterns are my own small matcher:** literal segments and `:name`, the first match wins, and a trailing slash doesn't matter. It's a subset of URLPattern's syntax, so moving to URLPattern later won't change existing patterns. Anything else (`*`, `:id?`, groups) throws, rather than half-working.
   - **Why not URLPattern now:** I'm not sure every browser we test in ships it yet. The page and the edge must match identically, and one small matcher guarantees that.
   - **Order matters:** in the store sample, `/products/categories` comes before `/products/:id`.
3. **Safety, since anyone may install an app:**
   - **A visitor's query string isn't passed to the API** on aligned routes. Otherwise anyone could add parameters to the app's API calls. A mapped source can still have its own fixed query (`/people?name={name}&full=1`). If you want queries passed through, a route could opt in later (`"query": true`).
   - **A path can't climb out of the `api`:** `..` and `%2e%2e` are refused, and so is a parameter that is `.` or `..`.
   - **Placeholders are URI-encoded,** so a `/` in a parameter can't add a path segment.
   - **Sources must be http(s).** The `api` can't carry a query or hash.
   - **Errors name the problem:** `validateApp` throws, for instance, when a `{name}` placeholder isn't a parameter of its route, or a source is named `route` (taken by the path's parameters).
4. **Relative source URLs are appended to the `api`'s path,** not resolved as URLs. With `api: https://x.com/v2`, the source `/products` is `https://x.com/v2/products`, not `https://x.com/products`.
5. **The installed app holds its transforms,** keyed by their o2h keys: `{ api, layout, routes: [{ pattern, …, transform: <key> }], transforms }`. Routes with the same config share one transform: the store's three grid routes become one. One install covers the whole app, and the app's key covers its transforms too.
6. **Module references are resolved on the page before preparing.** `resolveModules` imports the real code, and `prepareO2HTransform` then turns it into stand-ins, as it does today. So the edge never sees `{ import, export }`, and o2h needs no change for it.
7. **The app's key is `app-` plus 32 hex digits** of its SHA-256, the same scheme as `o2h-…` transforms. The edge can recompute it from the PUT body (a test checks this).

### Links within the app: one thing to settle before `mirror`

The store's links are hashes today (`#product/3`). With real paths, the fragment's links should be **relative to the app's base** (`href="products/3"`), so the same app works under `/store/` and under `/o2h-edge/demo/store/`. But relative links resolve against the current page's URL. From `/store/products/3`, `products/1` would become `/store/products/products/1`.

**My suggestion:** the shell sets `<base href="/store/">` (Angular apps do the same), and `mirror` takes its base from `document.baseURI`, so it needs no `base` option at all. Links in the app's trees stay relative. The cost is that every relative URL in the shell, such as stylesheets and scripts, resolves against that base too. That's usually what an app wants anyway.

### Next steps

1. **Step 2, in o2h-edge:**
   - `PUT /o2h-app/<key>`: check the key against the body, `validateApp`, a size cap, and storage in KV;
   - `GET /o2h-app/<key>/<path>`: match the route, fetch its sources in parallel through the existing guards, render with the route's transform, and return the fragment with the VM embedded.
   - o2h-edge would depend on navigate-gingerly. Until it's published, that would be a local `file:` dependency or a link.
2. **Step 3:** `mirror` here, then the store rebuilt on it.

### Questions

1. **The `<base href>` approach** for links and for finding the base?
2. **Step 2:** go ahead with the edge endpoints in o2h-edge, with navigate-gingerly as a local dependency until it's published?
3. **The `aria-current` convention in `mirror`** instead of an `eq` pipe: OK?