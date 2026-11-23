import { useSyncExternalStore } from 'react';
import type { ControllerView, DeckController } from '@/deck/controller';

const EMPTY = (): ControllerView | null => null;

/** Subscribes a component to the controller's throttled view. */
export function useDeck(controller: DeckController | null): ControllerView | null {
  return useSyncExternalStore(
    controller ? controller.subscribe : () => () => {},
    controller ? controller.getView : EMPTY,
    EMPTY,
  );
}
