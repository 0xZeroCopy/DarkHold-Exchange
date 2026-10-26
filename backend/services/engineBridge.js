import net from 'net';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { EscrowService } from './escrowService.js'; // Ensure correct import path

// Safely resolve directory path in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class EngineBridge {
  constructor() {
    this.client = new net.Socket();
    this.connected = false;

    // Resolve path relative to this file's exact location (backend/services/)
    const enginePath = path.resolve(__dirname, '../../cpp-engine/build/matching_engine.exe');
    
    console.log(`🚀 Starting C++ Matching Engine process at: ${enginePath}`);
    this.engineProcess = spawn(enginePath, [], {
      stdio: ['ignore', 'inherit', 'inherit'] 
    });

    // Catch hidden spawn errors
    this.engineProcess.on('error', (err) => {
      console.error(`❌ Failed to start C++ engine. Path issue: ${err.message}`);
    });

    this.engineProcess.on('close', (code) => {
      console.error(`🔴 C++ Engine process exited with code ${code}`);
      this.connected = false;
    });

    setTimeout(() => this.connectToEngine(), 1000);
  }

  connectToEngine() {
    this.client.connect(9000, '127.0.0.1', () => {
      console.log('🟢 Connected to C++ Engine TCP Server');
      this.connected = true;
    });

    this.client.on('data', (data) => {
      this.handleEngineEvent(data.toString().trim());
    });

    this.client.on('error', (err) => {
      console.error(`[TCP Bridge Error]: ${err.message}`);
    });

    this.client.on('close', () => {
      console.log('⚠️ TCP connection closed. Reconnecting in 3s...');
      this.connected = false;
      setTimeout(() => this.connectToEngine(), 3000);
    });
  }

  submitOrderToEngine(order) {
    if (!this.connected) return;
    
    const account = order.accountID || 'system';
    const isBuyFlag = order.isBuy ? 1 : 0;
    const payload = `P ${order.orderID} ${account} ${isBuyFlag} ${order.price} ${order.quantityRemaining}\n`;
    
    this.client.write(payload);
  }

  cancelOrderInEngine(orderID) {
    if (!this.connected) return;
    this.client.write(`C ${orderID}\n`);
  }

  handleEngineEvent(rawOutput) {
    const lines = rawOutput.split('\n');
    lines.forEach((line) => {
      const parts = line.trim().split(' ');
      
      if (parts[0] === 'F' && parts.length >= 4) {
        const tradeID = parts[1];
        const price = parseInt(parts[2], 10);
        const qty = parseInt(parts[3], 10);
        
        console.log(`⚡ MATCH EXECUTED: ${qty} tix @ $${price} (Trade #${tradeID})`);
      } else if (parts[0] === 'X') {
        console.log(`❌ Cancel Status: ${parts[1]}`);
      }
    });
  }
}

export const engineBridge = new EngineBridge();