import { exit } from 'process';
import { config } from './config';
import { clobService } from './services/clob-client';
import { Market } from './types';

async function printMarketsEndingSoon() {
  console.log('Initializing...');
  await clobService.initialize();

  console.log('Fetching all markets...\n');
  const markets = await clobService.getMarkets();

  console.log('='.repeat(100));
  console.log(`TOTAL MARKETS (${markets.length} found)`);
  console.log('='.repeat(100));

  const now = new Date();
  const in24Hours = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  // Filter markets ending within 24 hours
  const endingSoon = markets.filter((m) => {
    if (!m.endDate) return false;
    const endDate = new Date(m.endDate);
    return endDate > now && endDate <= in24Hours;
  });

  // Sort by end date
  endingSoon.sort((a, b) => {
    return new Date(a.endDate).getTime() - new Date(b.endDate).getTime();
  });

  console.log('='.repeat(100));
  console.log(`MARKETS ENDING IN NEXT 24 HOURS (${endingSoon.length} found)`);
  console.log('='.repeat(100));
  console.log();

  exit(0);

  throw new Error('STOP');

  for (const market of endingSoon) {
    const endDate = new Date(market.endDate);
    const hoursLeft = ((endDate.getTime() - now.getTime()) / (1000 * 60 * 60)).toFixed(1);

    console.log('-'.repeat(100));
    console.log(`ID: ${market.id}`);
    console.log(`Question: ${market.question}`);
    console.log(`End Date: ${market.endDate} (${hoursLeft} hours left)`);
    console.log(`Liquidity: $${parseFloat(market.liquidity || '0').toFixed(2)}`);
    console.log(`Volume: $${parseFloat(market.volume || '0').toFixed(2)}`);
    console.log(`Active: ${market.active} | Closed: ${market.closed}`);
    console.log(`Slug: ${market.slug}`);
    console.log(`URL: https://polymarket.com/event/${market.slug}`);

    if (market.tokens && market.tokens.length > 0) {
      console.log('Outcomes:');
      for (const token of market.tokens) {
        const price = token.price;
        const probability = (price * 100).toFixed(1);
        console.log(`  - ${token.outcome}: $${price.toFixed(3)} (${probability}%) | TokenID: ${token.tokenId}`);
      }
    } else if (market.outcomes && market.outcomePrices) {
      console.log('Outcomes:');
      for (let i = 0; i < market.outcomes.length; i++) {
        const price = parseFloat(market.outcomePrices[i] || '0');
        const probability = (price * 100).toFixed(1);
        console.log(`  - ${market.outcomes[i]}: $${price.toFixed(3)} (${probability}%)`);
      }
    }
    console.log();
  }

  console.log('='.repeat(100));
  console.log(`Total: ${endingSoon.length} markets ending within 24 hours`);
  console.log('='.repeat(100));

  // Also show summary of high-probability outcomes

  // console.log('\n\nHIGH PROBABILITY OUTCOMES (>90%):');
  // console.log('-'.repeat(100));

  // for (const market of endingSoon) {
  //   const hoursLeft = ((new Date(market.endDate).getTime() - now.getTime()) / (1000 * 60 * 60)).toFixed(1);

  //   if (market.tokens) {
  //     for (const token of market.tokens) {
  //       console.log(`[${hoursLeft}h] ${token.outcome}: ${(token.price * 100).toFixed(1)}% - ${market.question.substring(0, 60)}...`);
  //       if (token.price >= 0.50) {
  //         console.log(`[${hoursLeft}h] ${token.outcome}: ${(token.price * 100).toFixed(1)}% - ${market.question.substring(0, 60)}...`);
  //       }
  //     }
  //   }
  // }

  process.exit(0);
}

printMarketsEndingSoon().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
