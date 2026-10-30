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