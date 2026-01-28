// Debug tool for Hudson Yards issue
const { createClient } = require('mta-realtime-subway-departures');
const mtaStationIds = require('mta-subway-stations');
const fs = require('fs-extra');

async function debugHudsonYards() {
  console.log('🔍 DEBUGGING HUDSON YARDS ISSUE\n');

  // Your API key from the config
  const apiKey = 'DwjupUGa9Q4EVd3Tr2NLC7hu4bWspEbN3yFrI6GU';

  console.log('1️⃣ Testing Station Data:');
  const hudsonYards = mtaStationIds.find(s => s['Station ID'] === '471');
  console.log('   Station ID:', hudsonYards['Station ID']);
  console.log('   Complex ID:', hudsonYards['Complex ID']);
  console.log('   Stop Name:', hudsonYards['Stop Name']);
  console.log('   Line:', hudsonYards['Line']);
  console.log('   Routes:', hudsonYards['Daytime Routes'].join(', '));
  console.log('   North Label:', hudsonYards['North Direction Label']);
  console.log('   South Label:', hudsonYards['South Direction Label']);

  console.log('\n2️⃣ Testing Complex Mapping:');
  try {
    const complexesData = await fs.readFile(`${__dirname}/node_modules/mta-subway-complexes/complexes.json`, 'utf8');
    const stationIds = JSON.parse(complexesData);
    console.log('   Complex 471 exists:', stationIds['471'] ? 'YES' : 'NO');
    if (stationIds['471']) {
      console.log('   Complex name:', stationIds['471'].name);
    }
  } catch (err) {
    console.log('   ❌ Cannot read complexes.json:', err.message);
  }

  console.log('\n3️⃣ Testing MTA API:');
  const client = createClient(apiKey);

  try {
    // Test working station first (164 - ACE)
    console.log('   Testing ACE station (164)...');
    const aceResponse = await client.departures([164]);
    console.log('   ✅ ACE works:', aceResponse.lines?.length || 0, 'lines');

    // Test Hudson Yards
    console.log('   Testing Hudson Yards (471)...');
    const hudsonResponse = await client.departures([471]);
    console.log('   ✅ Hudson Yards API call successful');
    console.log('   📊 Lines:', hudsonResponse.lines?.length || 0);

    if (hudsonResponse.lines && hudsonResponse.lines.length > 0) {
      hudsonResponse.lines.forEach((line, i) => {
        console.log(`   Line ${i}: ${line.departures.S.length} southbound, ${line.departures.N.length} northbound`);

        // Show first few departures
        if (line.departures.N.length > 0) {
          console.log('   First few northbound trains:');
          line.departures.N.slice(0, 3).forEach(dep => {
            const time = new Date(dep.time * 1000).toLocaleTimeString();
            console.log(`     🚇 ${dep.routeId} to ${dep.destinationStationId} at ${time}`);
          });
        }

        if (line.departures.S.length > 0) {
          console.log('   First few southbound trains:');
          line.departures.S.slice(0, 3).forEach(dep => {
            const time = new Date(dep.time * 1000).toLocaleTimeString();
            console.log(`     🚇 ${dep.routeId} to ${dep.destinationStationId} at ${time}`);
          });
        }
      });
    } else {
      console.log('   ⚠️  No line data returned');
    }

  } catch (error) {
    console.error('   ❌ MTA API Error:', error.message);

    // Test if it's a specific 7-line feed issue
    try {
      console.log('   Testing Times Square (127) - also serves 7 train...');
      const tsResponse = await client.departures([127]);
      console.log('   ✅ Times Square works:', tsResponse.lines?.length || 0, 'lines');
    } catch (err) {
      console.error('   ❌ Times Square also fails - might be 7 line feed issue');
    }
  }

  console.log('\n4️⃣ Simulating Module Processing:');
  try {
    const hudsonResponse = await client.departures([471]);

    // Simulate the FIXED processing logic
    let upTown = [];
    let downTown = [];

    const responses = Array.isArray(hudsonResponse) ? hudsonResponse : [hudsonResponse];
    const dirUpTown = [true];   // From your config
    const dirDownTown = [true]; // From your config

    responses.forEach((response, n) => {
      if (response.lines) {
        response.lines.forEach((line) => {
          // Southbound
          line.departures.S.forEach((i) => {
            if (dirDownTown[n]) {
              downTown.push({ routeId: i.routeId, time: i.time });
            }
          });

          // Northbound - FIXED VERSION (no nested loop)
          line.departures.N.forEach((i) => {
            if (dirUpTown[n]) {
              upTown.push({ routeId: i.routeId, time: i.time });
            }
          });
        });
      }
    });

    console.log('   📊 Processed results:');
    console.log(`   Uptown trains: ${upTown.length}`);
    console.log(`   Downtown trains: ${downTown.length}`);

    if (upTown.length === 0 && downTown.length === 0) {
      console.log('   🚨 NO TRAINS PROCESSED - This explains why nothing shows!');
    }

  } catch (err) {
    console.log('   ❌ Processing simulation failed:', err.message);
  }

  console.log('\n5️⃣ DIAGNOSIS:');
  if (hudsonYards['South Direction Label'] === '') {
    console.log('   ℹ️  Hudson Yards only has northbound service (to Queens)');
  }
}

debugHudsonYards().catch(console.error);