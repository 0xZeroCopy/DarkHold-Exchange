import assert from 'assert';
import { TICKER_COLLARS, getCollarForTicker, updateCollar } from '../server.js';

console.log('===============================================================');
console.log('   Running Anti-Scalping Dynamic Price Collars Test Suite      ');
console.log('===============================================================');

// 1. Verify default face values and collars for all 5 ticket types
const expectedTiers = [
  { id: 1, symbol: 'TICK-1', name: 'VIP Pass', faceValue: 100, maxPrice: 200 },
  { id: 2, symbol: 'TICK-2', name: 'General Admission', faceValue: 50, maxPrice: 100 },
  { id: 3, symbol: 'TICK-3', name: 'Early Bird', faceValue: 40, maxPrice: 80 },
  { id: 4, symbol: 'TICK-4', name: 'Backstage Access', faceValue: 80, maxPrice: 160 },
  { id: 5, symbol: 'TICK-5', name: 'Balcony Tier', faceValue: 30, maxPrice: 60 },
];

for (const tier of expectedTiers) {
  const collar = getCollarForTicker(tier.id);
  assert.strictEqual(collar.tickerId, tier.id, `Ticker ${tier.id} ID match`);
  assert.strictEqual(collar.symbol, tier.symbol, `Ticker ${tier.id} symbol match`);
  assert.strictEqual(collar.faceValue, tier.faceValue, `Ticker ${tier.id} face value match`);
  assert.strictEqual(collar.maxPrice, tier.maxPrice, `Ticker ${tier.id} collar cap must be 2x face value ($${tier.maxPrice})`);
  console.log(`  ✓ ${collar.symbol} (${collar.name}): Face value $${collar.faceValue} -> Dynamic Collar Cap $${collar.maxPrice}`);
}

// 2. Test collar rejection check
function simulateCollarCheck(tickerId, price) {
  const collar = getCollarForTicker(tickerId);
  if (!Number.isInteger(price) || price < 1) {
    return { allowed: false, error: 'Price must be a whole dollar of at least $1.' };
  }
  if (price > collar.maxPrice) {
    return {
      allowed: false,
      error: `Price collar violation: ${collar.symbol} price ($${price}) exceeds anti-scalping price ceiling of $${collar.maxPrice} (${collar.collarMultiplier}x face value $${collar.faceValue}).`,
    };
  }
  return { allowed: true };
}

// VIP Pass: face value $100 -> cap $200
assert.strictEqual(simulateCollarCheck(1, 100).allowed, true, 'At face value allowed');
assert.strictEqual(simulateCollarCheck(1, 200).allowed, true, 'At collar ceiling allowed');
assert.strictEqual(simulateCollarCheck(1, 201).allowed, false, 'Exceeding collar rejected');
console.log('  ✓ TICK-1: $200 allowed, $201 rejected (anti-scalping collar cap $200)');

// General Admission: face value $50 -> cap $100
assert.strictEqual(simulateCollarCheck(2, 50).allowed, true, 'At face value allowed');
assert.strictEqual(simulateCollarCheck(2, 100).allowed, true, 'At collar ceiling allowed');
assert.strictEqual(simulateCollarCheck(2, 101).allowed, false, 'Exceeding collar rejected');
console.log('  ✓ TICK-2: $100 allowed, $101 rejected (anti-scalping collar cap $100)');

// Balcony Tier: face value $30 -> cap $60
assert.strictEqual(simulateCollarCheck(5, 30).allowed, true, 'At face value allowed');
assert.strictEqual(simulateCollarCheck(5, 60).allowed, true, 'At collar ceiling allowed');
assert.strictEqual(simulateCollarCheck(5, 61).allowed, false, 'Exceeding collar rejected');
console.log('  ✓ TICK-5: $60 allowed, $61 rejected (anti-scalping collar cap $60)');

// 3. Test dynamic collar modification at runtime
const updated = updateCollar(5, { collarMultiplier: 1.5 });
assert.strictEqual(updated.maxPrice, 45, 'Dynamic collar multiplier update: $30 * 1.5 = $45');
assert.strictEqual(simulateCollarCheck(5, 45).allowed, true, '$45 now allowed under new dynamic cap');
assert.strictEqual(simulateCollarCheck(5, 46).allowed, false, '$46 now rejected under new dynamic cap');
console.log('  ✓ Dynamic collar adjustment: multiplier 1.5x -> new cap $45 enforced');

// Restore default
updateCollar(5, { collarMultiplier: 2.0 });
assert.strictEqual(getCollarForTicker(5).maxPrice, 60, 'Restored collar cap $60');

console.log('===============================================================');
console.log('   All Anti-Scalping Price Collar Tests Passed Successfully!   ');
console.log('===============================================================');
process.exit(0);

