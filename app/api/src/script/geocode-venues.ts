/**
 * Geocode Venues Script
 *
 * Uses the free Nominatim (OpenStreetMap) geocoding API to look up
 * lat/lng coordinates for all venues that don't have them yet,
 * then propagates coordinates to matching events.
 *
 * Rate limited: 1 request per second (Nominatim policy).
 *
 * Usage:
 *   cd server && npx tsx src/scripts/geocode-venues.ts
 */

import 'dotenv/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { eq, isNull, sql } from 'drizzle-orm';
import * as schema from '@wheresthefx/db';

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/wheresthefx';

const pgSql = postgres(DATABASE_URL, { max: 3 });
const db = drizzle(pgSql, { schema });

// Metro Manila bounding box for search bias
const METRO_MANILA = {
  viewbox: '120.85,14.35,121.15,14.80',
  countrycodes: 'ph',
};

// Manual overrides for well-known Metro Manila venues
const MANUAL_GEOCODES: Record<string, { lat: number; lng: number; address?: string }> = {
  'jaime velasquez park': { lat: 14.5609, lng: 121.0224, address: 'Salcedo Village, Makati' },
  'salcedo market': { lat: 14.5609, lng: 121.0224, address: 'Jaime Velasquez Park, Salcedo Village, Makati' },
  'legazpi sunday market': { lat: 14.5537, lng: 121.0146, address: 'Legazpi Active Park, Makati' },
  'sm mall of asia arena': { lat: 14.5335, lng: 120.9828, address: 'SM Mall of Asia Complex, Pasay' },
  'new frontier theater': { lat: 14.6264, lng: 121.0567, address: 'Gen. Romulo Ave, Cubao, Quezon City' },
  'gateway mall': { lat: 14.6182, lng: 121.0558, address: 'Araneta City, Cubao, Quezon City' },
  'up diliman': { lat: 14.6538, lng: 121.0686, address: 'University of the Philippines Diliman, Quezon City' },
  'ayala malls circuit': { lat: 14.5651, lng: 121.0185, address: 'Circuit Lane, Makati' },
  'the filinvest tent': { lat: 14.5314, lng: 121.0207, address: 'Filinvest City, Alabang, Muntinlupa' },
  'metrotent convention center': { lat: 14.5319, lng: 121.0220, address: 'Filinvest City, Alabang, Muntinlupa' },
  '19 east': { lat: 14.5233, lng: 121.0478, address: '19th Ave, Sucat, Parañaque' },
  'smdc festival grounds': { lat: 14.5325, lng: 120.9835, address: 'SM Mall of Asia Complex, Pasay' },
  'alveo central plaza': { lat: 14.5509, lng: 121.0475, address: 'High Street, BGC, Taguig' },
  '78 salcedo': { lat: 14.5613, lng: 121.0230, address: '78 L.P. Leviste St., Salcedo Village, Makati' },
  '78salcedo': { lat: 14.5613, lng: 121.0230, address: '78 L.P. Leviste St., Salcedo Village, Makati' },
  '78-33': { lat: 14.5613, lng: 121.0230, address: '78 L.P. Leviste St., Salcedo Village, Makati' },
  '78-45-33': { lat: 14.5613, lng: 121.0230, address: '78 L.P. Leviste St., Salcedo Village, Makati' },
  'bgcartscenter': { lat: 14.5510, lng: 121.0485, address: 'BGC Arts Center, Taguig' },
  'globe auditorium, maybank performing arts theater': { lat: 14.5338, lng: 121.0186, address: 'Circuit Makati, Makati' },
  'dolores l. tan hall, maybank performing arts theater': { lat: 14.5338, lng: 121.0186, address: 'Circuit Makati, Makati' },
  '63 maginhawa quezon city': { lat: 14.6371, lng: 121.0414, address: 'Maginhawa St., Teachers Village, Quezon City' },
  '63 maginhawa, diliman, quezon city': { lat: 14.6371, lng: 121.0414, address: 'Maginhawa St., Teachers Village, Quezon City' },
  'up diliman, gyud food': { lat: 14.6538, lng: 121.0686, address: 'UP Diliman, Quezon City' },
  '18 jade': { lat: 14.5530, lng: 121.0175, address: 'Chino Roces Extension, Makati' },
};

/** Sleep helper for rate limiting */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Geocode a venue name using Nominatim */
async function geocodeWithNominatim(query: string): Promise<{ lat: number; lng: number; address: string } | null> {
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('q', `${query}, Metro Manila, Philippines`);
  url.searchParams.set('format', 'json');
  url.searchParams.set('limit', '1');
  url.searchParams.set('viewbox', METRO_MANILA.viewbox);
  url.searchParams.set('bounded', '0');
  url.searchParams.set('countrycodes', METRO_MANILA.countrycodes);

  try {
    const res = await fetch(url.toString(), {
      headers: { 'User-Agent': 'WheresTheFX/1.0 (event-discovery-platform)' },
    });

    if (!res.ok) return null;

    const results = await res.json() as any[];
    if (results.length === 0) return null;

    return {
      lat: parseFloat(results[0].lat),
      lng: parseFloat(results[0].lon),
      address: results[0].display_name,
    };
  } catch {
    return null;
  }
}

async function main() {
  console.log('🗺️  Geocoding venues without coordinates...\n');

  // Get all unique venue names from event that lack geocoding
  const ungeocodedEvents = await db.selectDistinct({
    venueName: schema.event.venueName,
  })
  .from(schema.event)
  .where(isNull(schema.event.venueLat));

  const uniqueName = [...new Set(
    ungeocodedEvents
      .map(e => e.venueName)
      .filter((n): n is string => !!n)
  )];

  console.log(`Found ${uniqueName.length} unique venue names to geocode\n`);

  let geocoded = 0;
  let failed = 0;

  for (const name of uniqueName) {
    const normalized = name.toLowerCase().trim();

    // Check manual overrides first
    let result = MANUAL_GEOCODES[normalized];

    if (result) {
      console.log(`📍 ${name} → Manual: ${result.lat.toFixed(4)}, ${result.lng.toFixed(4)}`);
    } else {
      // Try Nominatim
      await sleep(1100); // Rate limit: 1 req/sec
      const nominatimResult = await geocodeWithNominatim(name);

      if (nominatimResult) {
        result = nominatimResult;
        console.log(`📍 ${name} → Nominatim: ${result.lat.toFixed(4)}, ${result.lng.toFixed(4)}`);
      } else {
        console.log(`❌ ${name} → Not found`);
        failed++;
        continue;
      }
    }

    // Update venue table
    await db.update(schema.venue)
      .set({
        lat: result.lat,
        lng: result.lng,
        address: result.address || undefined,
      })
      .where(eq(schema.venue.name, name));

    // Update event table (denormalized lat/lng)
    await db.update(schema.event)
      .set({
        venueLat: result.lat,
        venueLng: result.lng,
        venueAddress: result.address || undefined,
        locationStatus: 'confirmed',
      })
      .where(eq(schema.event.venueName, name));

    geocoded++;
  }

  // Also propagate coordinates from venue → event via venueId
  const venuesWithCoords = await db.select({
    id: schema.venue.venueId,
    lat: schema.venue.lat,
    lng: schema.venue.lng,
    address: schema.venue.address,
  }).from(schema.venue)
    .where(sql`${schema.venue.lat} IS NOT NULL`);

  for (const v of venuesWithCoords) {
    await db.update(schema.event)
      .set({
        venueLat: v.lat!,
        venueLng: v.lng!,
        venueAddress: v.address || undefined,
      })
      .where(sql`${schema.event.venueId} = ${v.id} AND ${schema.event.venueLat} IS NULL`);
  }

  // Final count
  const [{ count }] = await db.select({
    count: sql<number>`count(*)`,
  }).from(schema.event)
    .where(sql`${schema.event.venueLat} IS NOT NULL`);

  console.log(`\n✅ Geocoding complete: ${geocoded} succeeded, ${failed} failed`);
  console.log(`📊 Events with coordinates: ${count}`);

  await pgSql.end();
}

main().catch(err => {
  console.error('❌ Geocoding failed:', err);
  process.exit(1);
});
