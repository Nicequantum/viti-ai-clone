'use client';

import { useCallback, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import { toast } from 'sonner';
import { api, ApiError } from '@/lib/api';
import { debounce } from '@/lib/debounce';
import {
  awaitRepairOrderSaveQueue,
  awaitRepairOrderSaveQueueWithTimeout,
  enqueueRepairOrderSave,
} from '@/lib/repairOrderSaveQueue';
import type { RepairOrder } from '@/types';
import { ensureComplaintIds } from '@/utils/repairOrderFactory';

/** Keep in-memory stories when a stale queued PUT returns before the server caught up. */
export function preserveClientWarrantyStories(
  persisted: RepairOrder,
  client: RepairOrder | null
): RepairOrder {
  if (!client || client.id !== persisted.id) return persisted;

  let changed = false;
  const repairLines = persisted.repairLines.map((line) => {
    const clientLine = client.repairLines.find((l) => l.id === line.id);
    const clientStory = clientLine?.warrantyStory?.trim();
    if (!clientStory) return line;

    const persistedStory = line.warrantyStory?.trim();
    if (!persistedStory) {
      changed = true;
      return { ...line, warrantyStory: clientLine!.warrantyStory };
    }
    return line;
  });

  return changed ? { ...persisted, repairLines } : persisted;
}

/** M21: persistence, debounced save, and serialized PUT queue extracted from useRepairOrders. */
export function useROPersistence(
  allROs: RepairOrder[],
  setAllROs: Dispatch<SetStateAction<RepairOrder[]>>,
  roRef: MutableRefObject<RepairOrder | null>,
  setCurrentRO: Dispatch<SetStateAction<RepairOrder | null>>
) {
  const persistRO = useCallback(
    async (ro: RepairOrder): Promise<RepairOrder> => {
      return enqueueRepairOrderSave(async () => {
        // Always PUT the latest in-memory RO — stale queue entries must not wipe generated stories.
        const payload = roRef.current?.id === ro.id ? roRef.current : ro;
        const isNew = !allROs.some((r) => r.id === payload.id) || payload.id.startsWith('ro-');
        if (isNew && payload.id.startsWith('ro-')) {
          const { repairOrder } = await api.createRepairOrder(payload);
          setAllROs((prev) => [repairOrder, ...prev.filter((r) => r.id !== payload.id)]);
          return repairOrder;
        }
        const { repairOrder } = await api.updateRepairOrder(payload.id, payload);
        setAllROs((prev) => prev.map((r) => (r.id === repairOrder.id ? repairOrder : r)));
        return repairOrder;
      });
    },
    [allROs, roRef, setAllROs]
  );

  const saveROImmediate = useCallback(
    async (ro: RepairOrder | null) => {
      if (ro) {
        try {
          const persisted = await persistRO(ro);
          let saved = ensureComplaintIds(
            ro.complaintIds && ro.complaintIds.length === persisted.complaints.length
              ? { ...persisted, complaintIds: ro.complaintIds }
              : persisted
          );
          saved = preserveClientWarrantyStories(saved, roRef.current);
          roRef.current = saved;
          setCurrentRO(saved);
          setAllROs((prev) => {
            const idx = prev.findIndex((r) => r.id === saved.id);
            if (idx >= 0) {
              const copy = [...prev];
              copy[idx] = saved;
              return copy;
            }
            return [saved, ...prev];
          });
        } catch (e) {
          if (e instanceof ApiError && e.status === 409) {
            toast.error(e.message);
            return;
          }
          toast.error(e instanceof Error ? e.message : 'Failed to save repair order');
        }
      } else {
        roRef.current = null;
        setCurrentRO(null);
      }
    },
    [persistRO, roRef, setAllROs, setCurrentRO]
  );

  const debouncedPersistRef = useRef(
    debounce((ro: RepairOrder) => {
      void saveROImmediate(ro);
    }, 450)
  );

  const flushPendingSave = useCallback(async (options?: { maxWaitMs?: number }) => {
    await debouncedPersistRef.current.flush();
    const maxWaitMs = options?.maxWaitMs;
    if (maxWaitMs && maxWaitMs > 0) {
      await awaitRepairOrderSaveQueueWithTimeout(maxWaitMs);
      return;
    }
    await awaitRepairOrderSaveQueue();
  }, []);

  const scheduleSaveRO = useCallback((ro: RepairOrder) => {
    debouncedPersistRef.current(ro);
  }, []);

  const applyROUpdate = useCallback(
    (updater: (ro: RepairOrder) => RepairOrder, options?: { immediate?: boolean }) => {
      const base = roRef.current;
      if (!base) return null;
      const updated = ensureComplaintIds(structuredClone(updater(base)));
      roRef.current = updated;
      setCurrentRO(updated);
      setAllROs((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
      if (options?.immediate) {
        debouncedPersistRef.current.cancel();
        void saveROImmediate(updated);
      } else {
        scheduleSaveRO(updated);
      }
      return updated;
    },
    [roRef, saveROImmediate, scheduleSaveRO, setAllROs, setCurrentRO]
  );

  const cancelPendingSave = useCallback(() => {
    debouncedPersistRef.current.cancel();
  }, []);

  return {
    persistRO,
    saveROImmediate,
    flushPendingSave,
    cancelPendingSave,
    scheduleSaveRO,
    applyROUpdate,
    debouncedPersistRef,
  };
}