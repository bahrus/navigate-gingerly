# Mark Current

## Background

From [Initialization.md](../Initialization.md#navigate-gingerly-mirror):

- **After a render:**
  - the title comes from the route;
  - **`markCurrent`** sets `aria-current="page"` on links in the container that point to the current page.

From [Initialization.md](../Initialization.md#questions)

> 3. **Links outside the container:** `markCurrent` only looks inside `into`. Should it also mark the shell's own links, such as a header nav? I left them alone, since the shell is the app's own markup.