import { useRef, useCallback } from "react";

/**
 * Hook for managing multiple timeouts with automatic cleanup
 */
export const useTimeoutManager = () => {
  const timeoutsRef = useRef<NodeJS.Timeout[]>([]);

  const addTimeout = useCallback((callback: () => void, delay: number) => {
    const timeout = setTimeout(callback, delay);
    timeoutsRef.current.push(timeout);
    return timeout;
  }, []);

  const clearAll = useCallback(() => {
    timeoutsRef.current.forEach((timeout) => clearTimeout(timeout));
    timeoutsRef.current = [];
  }, []);

  const clear = useCallback((timeout: NodeJS.Timeout) => {
    clearTimeout(timeout);
    timeoutsRef.current = timeoutsRef.current.filter((t) => t !== timeout);
  }, []);

  return { addTimeout, clearAll, clear, timeoutsRef };
};

/**
 * Hook for managing a Chinese query flag
 */
export const useQueryLanguage = () => {
  const isChineseRef = useRef(false);

  const setIsChinese = useCallback((value: boolean) => {
    isChineseRef.current = value;
  }, []);

  const reset = useCallback(() => {
    isChineseRef.current = false;
  }, []);

  return { isChineseRef, setIsChinese, reset };
};
