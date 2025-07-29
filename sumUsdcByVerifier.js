// sumUsdcByVerifier.js
const fs = require('fs');
const { ethers } = require('ethers');

const ESCROW_ADDRESS = '0xCA38607D85E8F6294Dc10728669605E6664C2D70';
const USDC_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const ABI = require('./escrowAbi.json');

const verifierMapping = {
  '0x76d33a33068d86016b806df02376ddbb23dd3703': { platform: 'Cash App', isUsdOnly: true },
  '0x9a733b55a875d0db4915c6b36350b24f8ab99df5': { platform: 'Venmo', isUsdOnly: true },
  '0xaa5a1b62b01781e789c900d616300717cd9a41ab': { platform: 'Revolut', isUsdOnly: false },
  '0xff0149799631d7a5bde2e7ea9b306c42b3d9a9ca': { platform: 'Wise', isUsdOnly: false },
  '0x03d17e9371c858072e171276979f6b44571c5dea': { platform: 'PayPal', isUsdOnly: false },
  '0x0de46433bd251027f73ed8f28e01ef05da36a2e0': { platform: 'Monzo', isUsdOnly: false },
  '0xf2ac5be14f32cbe6a613cff8931d95460d6c33a3': { platform: 'Mercado Pago', isUsdOnly: false },
  '0x431a078a5029146aab239c768a615cd484519af7': { platform: 'Zelle', isUsdOnly: true }
};

function formatLiquidity(verifierTotals) {
  // Convert to array and sort by amount (descending)
  const sortedEntries = Object.entries(verifierTotals)
    .map(([verifier, amount]) => {
      const info = verifierMapping[verifier.toLowerCase()];
      const name = info?.platform || verifier;
      const formatted = parseFloat(ethers.formatUnits(amount, 6)).toFixed(2);
      return { name, formatted, amount };
    })
    .sort((a, b) => parseFloat(b.formatted) - parseFloat(a.formatted));

  // Create table header
  let table = '```\n';
  table += '┌─────────────────┬─────────────────┐\n';
  table += '│ Platform        │ USDC Amount     │\n';
  table += '├─────────────────┼─────────────────┤\n';

  // Add rows
  sortedEntries.forEach(entry => {
    const platform = entry.name.padEnd(15);
    const amount = parseFloat(entry.formatted).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).padStart(15);
    table += `│ ${platform} │ ${amount} │\n`;
  });

  table += '└─────────────────┴─────────────────┘\n';
  table += '```\n\n';
  table += '_*Liquidity for multiple platforms can be counted twice_';

  return table;
}

async function runLiquidityReport() {
  const depositIds = JSON.parse(fs.readFileSync('activeDeposits.json'));
  const provider = new ethers.JsonRpcProvider(process.env.BASE_RPC_URL);
  const escrow = new ethers.Contract(ESCROW_ADDRESS, ABI, provider);
  const verifierTotals = {};

  for (let i = 0; i < depositIds.length; i += 10) {
    const batch = depositIds.slice(i, i + 10);
    const results = await escrow.getDepositFromIds(batch);
    for (const d of results) {
      if (d.deposit.token.toLowerCase() !== USDC_ADDRESS.toLowerCase()) continue;
      for (const v of d.verifiers) {
        const addr = v.verifier.toLowerCase();
        const amt = BigInt(d.deposit.remainingDeposits);
        verifierTotals[addr] = (verifierTotals[addr] || 0n) + amt;
      }
    }
  }

  return formatLiquidity(verifierTotals);
}

module.exports = { runLiquidityReport };
