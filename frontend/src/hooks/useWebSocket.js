import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Reconnecting WebSocket hook.
 * - `onOpen(send)` runs on every (re)connect, e.g. to register the user again.
 * - `onMessage(msg)` receives every message except plain depth snapshots.
 * - depthData / lastPrice are kept up to date from DEPTH_SNAPSHOT (and the depth in INIT_USER_DATA).
 */
export function useWebSocket(url, { onOpen, onMessage } = {}) {
  const [depthData, setDepthData] = useState({ bids: [], asks: [] });
  const [isConnected, setIsConnected] = useState(false);
  const [lastPrice, setLastPrice] = useState(null);

  const wsRef = useRef(null);
  const onOpenRef = useRef(onOpen);
  const onMessageRef = useRef(onMessage);
  useEffect(() => { onOpenRef.current = onOpen; onMessageRef.current = onMessage; }, [onOpen, onMessage]);

  const send = useCallback((payload) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify(payload));
    return true;
  }, []);

  useEffect(() => {
    let closed = false;
    let retries = 0;
    let timer;

    const applyDepth = (d) => {
      if (!d) return;
      setDepthData({ bids: d.bids || [], asks: d.asks || [] });
      setLastPrice(d.lastPrice ?? null);
    };

    const connect = () => {
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        retries = 0;
        setIsConnected(true);
        onOpenRef.current?.(send);
      };
      ws.onclose = () => {
        setIsConnected(false);
        if (!closed) timer = setTimeout(connect, Math.min(5000, 500 * 2 ** retries++));
      };
      ws.onerror = () => ws.close();
      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          if (message.type === 'DEPTH_SNAPSHOT') return applyDepth(message.data);
          if (message.type === 'INIT_USER_DATA') applyDepth(message.depth);
          onMessageRef.current?.(message);
        } catch (e) {
          console.error('WS parse error:', e);
        }
      };
    };

    connect();
    return () => {
      closed = true;
      clearTimeout(timer);
      wsRef.current?.close();
    };
  }, [url, send]);

  const sendOrder = (orderPayload) => send({ action: 'SUBMIT_ORDER', ...orderPayload });

  return { depthData, isConnected, lastPrice, send, sendOrder };
}
