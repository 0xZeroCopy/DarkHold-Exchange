import { spawn } from 'child_process';
import path from 'path';

class EngineBridge {
  constructor() {
    // Path to compiled C++ binary
    const enginePath = path.resolve('../cpp-engine/build/matching_engine.exe');
    
    // Spawn C++ binary process
    this.engine = spawn(enginePath, [], {
      stdio: ['pipe', 'pipe', 'inherit']
    });

    this.engine.stdout.on('data', (data) => {
      const output = data.toString().trim();
      console.log(`[C++ Engine Output]: ${output}`);
      // Parse trade execution events returned from C++
      this.handleEngineEvent(output);
    });

    this.engine.on('close', (code) => {
      console.error(`C++ Engine process exited with code ${code}`);
    });
  }

  // Send JSON order payload directly to C++ stdin
  submitOrderToEngine(order) {
    const payload = JSON.stringify({
      type: 'ADD_ORDER',
      orderId: order.orderID,
      isBuy: order.isBuy,
      price: order.price,
      quantity: order.quantityRemaining
    }) + '\n';

    if (this.engine.stdin.writable) {
      this.engine.stdin.write(payload);
    }
  }

  handleEngineEvent(rawOutput) {
    try {
      const lines = rawOutput.split('\n');
      lines.forEach((line) => {
        if (line.startsWith('{')) {
          const event = JSON.parse(line);
          if (event.type === 'TRADE') {
            console.log(`⚡ MATCH EXECUTED: ${event.quantity} tix @ $${event.price}`);
          }
        }
      });
    } catch (e) {
      // Non-JSON debug logs from C++
    }
  }
}

export const engineBridge = new EngineBridge();