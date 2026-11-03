# Retain Realized Routes

## Bruce's Ask

From o2h-edge's [SampleStoreApp.md](../../../o2h-edge/Chats/Store/SampleStoreApp.md#bruces-response---implement-in-mirror):

> Can you please create a TODO item to support retaining previously realized routes so they don't get thrown away? I guess this could be included when we work on caching.

## Background

`mirror` replaces the container's contents on every navigation (`into.innerHTML = html`, then hydration). Going back to a page the visitor has already seen means:
- asking the worker again;
- parsing and hydrating again;
- losing whatever the page held: scroll position inside it, an open `<details>`, a form being filled in, focus.

## Ideas to weigh, when we get to caching (the store's stage 5)

- **Keep, don't rebuild:** keep each realized route's nodes, detached, keyed by its history entry (`navigation.currentEntry.key`) or by path. Back and Forward put them back as they were, with no request and no hydration, and listeners still bound.
- **Or keep them in place, hidden:** one child of `into` per realized route. Hide the inactive ones with `hidden` plus `inert`, as lazyLoad's `toggleInert` does. Then the browser keeps their state as is, and a view transition can morph between two live trees.
- **How long to keep them:**
  - a cap (the last N entries);
  - entries the history can no longer reach are dropped (`navigation` `entries()`, and the `dispose` event of a `NavigationHistoryEntry`);
  - a per-route `retain: false` for pages that must always be fresh.
- **When to refresh:** a retained page may be stale. Options:
  - show it at once, then ask the worker and rebind in place, as the cart does: keyed `each`, so elements and focus survive;
  - ask the worker with `If-None-Match`, once the worker sends ETags (stage 5);
  - a `maxAge` per route.
- **What it isn't:** caching the worker's responses (HTTP caching, or the Cache API). That's stage 5 itself, and the two combine: a retained page needs no request at all, and a cached response skips the API.
- **Hooks:** `onRender`'s `by` could gain `retained`, so the page knows nothing was fetched.

## Relation to lazyLoad

The "keep in place, hidden" option is close to what lazyLoad already does for one template between comment markers: show and hide, with `forget` to remove instead, `toggleInert`, and transitions. If lazyLoad gets dynamic HTML includes (see assign-gingerly's [DynamicHtmlIncludes.md](../../../assign-gingerly/Chats/AssignFrom/Handlers/LazyLoad/TODO/DynamicHtmlIncludes.md)), mirror might keep one lazyLoad region per realized route, instead of its own bookkeeping.
