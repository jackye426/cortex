import { HeadContent, Outlet, createRootRoute } from "@tanstack/react-router";

/**
 * HeadContent renders the `head: () => ({ meta })` blocks declared by each route.
 * Without it those declarations are inert and every page keeps index.html's title.
 */
export const Route = createRootRoute({
  component: () => (
    <>
      <HeadContent />
      <Outlet />
    </>
  ),
});
