require('dotenv').config();
const { runLiquidityReport } = require('./sumUsdcByVerifier');

async function test() {
  try {
    console.log('🧪 Testing liquidity report with v3 contracts...\n');
    
    if (!process.env.BASE_RPC_URL) {
      console.error('❌ Error: BASE_RPC_URL environment variable is not set');
      console.log('💡 Please set it in a .env file or export it:');
      console.log('   export BASE_RPC_URL=https://mainnet.base.org');
      process.exit(1);
    }
    
    console.log(`📡 Using RPC: ${process.env.BASE_RPC_URL}`);
    console.log(`📋 Escrow Contract: 0x2f121CDDCA6d652f35e8B3E560f9760898888888\n`);
    
    const result = await runLiquidityReport();
    
    console.log('\n✅ Report generated successfully!');
    console.log('\n📊 Report Result:');
    console.log(JSON.stringify(result, null, 2));
    
  } catch (error) {
    console.error('\n❌ Error running liquidity report:');
    console.error(error);
    process.exit(1);
  }
}

test();

