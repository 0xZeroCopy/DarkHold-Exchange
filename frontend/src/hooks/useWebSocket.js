import { useEffect, useRef, useState } from 'react';

export function useWebSocket(url, onMessage) {
  const [depthData, setDepthData] = useState({ bids: [], asks: [] });
  const [isConnected, setIsConnected] = useState(false);
  const [lastPrice, setLastPrice] = useState(188.50);
  
  const wsRef = useRef(null);
  const pendingFrameRef = useRef(null);
  const onMessageRef = useRef(onMessage);

  // Keep the latest callback reference without triggering re-renders
  useEffect(() => {
    onMessageRef.current = onMessage;
  }, [onMessage]);

  useEffect(() => {
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => setIsConnected(true);
    ws.onclose = () => setIsConnected(false);

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);

        if (message.type === 'DEPTH_SNAPSHOT') {
          if (pendingFrameRef.current) cancelAnimationFrame(pendingFrameRef.current);
          pendingFrameRef.current = requestAnimationFrame(() => {
            setDepthData(message.data);
            if (message.data?.lastPrice) setLastPrice(message.data.lastPrice);
          });
        } else {
          // Instantly trigger the event callback for executions (No React state delays)
          if (onMessageRef.current) {
            onMessageRef.current(message);
          }
        }
      } catch (e) {
        console.error('WS Parse Error:', e);
      }
    };

    return () => {
      if (pendingFrameRef.current) cancelAnimationFrame(pendingFrameRef.current);
      ws.close();
    };
  }, [url]);

  const sendOrder = (orderPayload) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ action: 'SUBMIT_ORDER', ...orderPayload }));
    }
  };

  return { depthData, isConnected, lastPrice, sendOrder };
}