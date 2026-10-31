# Project Guidance

The same conventions as assign-gingerly and o2h (see assign-gingerly's `AGENTS.md` for the full text).

## Destructuring Style

When an `options`, `config`, or any parameter/object is accessed 2+ times in the same scope, destructure the needed
fields at the top of that scope. Don't destructure if a field is used only once.

## Types Location

All exported TypeScript interfaces and types are defined in `types/navigate-gingerly/types.d.ts` (the `types` folder
is a git submodule: https://github.com/bahrus/types). Module files import them from there. Internal types used only
in one module may stay in it.

## No dependency on o2h

The core (`routes.ts`, `app.ts`, `modules.ts`) is pure: no DOM, no fetch, no o2h. Whatever o2h does (preparing a
transform, rendering, hydrating) is passed in, so the page, o2h-edge and a service worker can all compose the two.

## Tests

Playwright. The core's tests run in Node (`tests/core.spec.ts`), importing the built `.js`, so build first.
