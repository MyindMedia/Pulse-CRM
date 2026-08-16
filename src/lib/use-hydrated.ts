"use client";

import * as React from "react";

const subscribeNever = () => () => {};
const onClient = () => true;
const onServer = () => false;

/**
 * False during the server render and the hydration render, true from the
 * first client commit onward.
 *
 * Anything the server could not know - localStorage, a websocket answer, the
 * viewport - has to be withheld until this flips, or the client's first
 * render disagrees with the HTML it is hydrating and React reports a
 * mismatch. Reading it through useSyncExternalStore rather than an effect
 * keeps that first render honest instead of correcting it a frame later.
 */
export function useHydrated() {
  return React.useSyncExternalStore(subscribeNever, onClient, onServer);
}
